import 'dotenv/config';
import { HttpStatus, ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import cookieParser from 'cookie-parser';
import * as OTPAuth from 'otpauth';
import request, { type Agent } from 'supertest';
import { AppModule } from '../src/app.module.js';
import { borrarCuentasPrueba, crearCuentasPrueba, type CuentasPrueba } from './cuentas-prueba.js';

/**
 * Pruebas e2e de seguridad. Corren contra la base de DESARROLLO (nunca
 * producción) y usan EXCLUSIVAMENTE cuentas propias creadas por
 * `cuentas-prueba.ts` (login "prueba.*"): nunca tocan gerente@demo.co,
 * coord.*@demo.co ni lider*@demo.co, que son de demostración.
 */

const ORIGEN = 'http://localhost:5173';
const CABECERA_CSRF = { 'X-Requested-With': 'campana' };

async function iniciarApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.init();
  return app;
}

function post(agente: Agent, path: string, body: object = {}) {
  return agente.post(path).set(CABECERA_CSRF).set('Origin', ORIGEN).send(body);
}

function extraerSecretoBase32(otpauthUri: string): string {
  const secreto = new URL(otpauthUri).searchParams.get('secret');
  if (!secreto) throw new Error('El URI otpauth no trae secreto');
  return secreto;
}

/**
 * `avanzarPasos` genera el código de un paso de tiempo posterior (30s cada
 * uno): hace falta porque, en la prueba de /mfa/verificar, el paso "actual"
 * ya quedó marcado como usado por la confirmación inicial en el setup, y
 * ambas llamadas ocurren dentro de la misma ventana de 30 segundos real.
 */
function codigoTotp(secretoBase32: string, avanzarPasos = 0): string {
  const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secretoBase32) });
  return totp.generate({ timestamp: Date.now() + avanzarPasos * totp.period * 1000 });
}

/** Valor crudo de una cookie en la respuesta (supertest no expone un jar simple para leerlo). */
function extraerCookie(res: request.Response, nombre: string): string | undefined {
  const cabeceras = (res.headers['set-cookie'] ?? []) as unknown as string[];
  for (const cabecera of cabeceras) {
    const [clave, valor] = cabecera.split(';')[0].split('=');
    if (clave === nombre) return valor;
  }
  return undefined;
}

interface ResultadoLogin {
  estado: string;
  renovacionInicial?: string;
  secretoBase32?: string;
  codigosRecuperacion?: string[];
}

/** Inicia sesión y, si hace falta, completa la configuración de doble factor hasta llegar a LISTO. */
async function iniciarSesionCompleta(agente: Agent, login: string, clave: string): Promise<ResultadoLogin> {
  const entrada = await post(agente, '/api/auth/login', { login, clave });
  if (entrada.status !== HttpStatus.OK) {
    throw new Error(`No se pudo iniciar sesión como ${login}: ${entrada.status} ${JSON.stringify(entrada.body)}`);
  }
  const renovacionInicial = extraerCookie(entrada, 'campana_renovacion');
  if (entrada.body.estado !== 'MFA_CONFIGURAR') {
    return { estado: entrada.body.estado, renovacionInicial };
  }

  const config = await post(agente, '/api/auth/mfa/configurar');
  const secretoBase32 = extraerSecretoBase32(config.body.otpauthUri);
  const confirmar = await post(agente, '/api/auth/mfa/confirmar', { codigo: codigoTotp(secretoBase32) });
  if (confirmar.status !== HttpStatus.CREATED && confirmar.status !== HttpStatus.OK) {
    throw new Error(`No se pudo confirmar el doble factor de ${login}: ${confirmar.status} ${JSON.stringify(confirmar.body)}`);
  }
  return { estado: 'LISTO', renovacionInicial, secretoBase32, codigosRecuperacion: confirmar.body.codigosRecuperacion };
}

// Cuentas propias de las pruebas: se crean una sola vez para todo el
// archivo y se borran por completo al final, sin importar cuántos
// `describe` las usen.
let cuentas: CuentasPrueba;

beforeAll(async () => {
  cuentas = await crearCuentasPrueba();
});

afterAll(async () => {
  await borrarCuentasPrueba(cuentas);
});

describe('Seguridad e2e (cuentas propias "prueba.*", nunca las de demostración)', () => {
  let app: INestApplication;

  let agenteGerente: Agent;
  let agenteCoordinadora: Agent;
  let agenteLider: Agent;
  let gerenteInfo: ResultadoLogin;
  let liderInfo: ResultadoLogin;

  beforeAll(async () => {
    app = await iniciarApp();

    agenteGerente = request.agent(app.getHttpServer());
    agenteCoordinadora = request.agent(app.getHttpServer());
    agenteLider = request.agent(app.getHttpServer());

    gerenteInfo = await iniciarSesionCompleta(agenteGerente, cuentas.gerente.login, cuentas.gerente.clave);
    await iniciarSesionCompleta(agenteCoordinadora, cuentas.coordinadora.login, cuentas.coordinadora.clave);
    liderInfo = await iniciarSesionCompleta(agenteLider, cuentas.lider.login, cuentas.lider.clave);
  });

  afterAll(async () => {
    await app.close();
  });

  it('un líder no requiere doble factor: entra directo a LISTO', () => {
    expect(liderInfo.estado).toBe('LISTO');
  });

  it('sin token -> 401 en una ruta protegida', async () => {
    const res = await request(app.getHttpServer()).get('/api/tablero/indicadores');
    expect(res.status).toBe(HttpStatus.UNAUTHORIZED);
  });

  it('una petición POST sin X-Requested-With -> 403 (protección CSRF)', async () => {
    // Se usa /auth/salir (sin el límite estricto de /auth/login) para no
    // gastar el cupo del limitador de fuerza bruta con esta prueba.
    const res = await request(app.getHttpServer()).post('/api/auth/salir').send();
    expect(res.status).toBe(HttpStatus.FORBIDDEN);
  });

  it('campos extra en el cuerpo -> 400', async () => {
    const res = await post(agenteLider, '/api/auth/cambiar-clave', {
      claveActual: 'lo-que-sea',
      claveNueva: 'OtraClave1234',
      campoQueNoExiste: 'x',
    });
    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
  });

  it('líder -> 403 en mapa, usuarios y metas', async () => {
    const mapa = await agenteLider.get('/api/territorio/mapa');
    expect(mapa.status).toBe(HttpStatus.FORBIDDEN);

    const usuarios = await agenteLider.get('/api/usuarios');
    expect(usuarios.status).toBe(HttpStatus.FORBIDDEN);

    const metas = await post(agenteLider, '/api/red/metas/miembro');
    expect(metas.status).toBe(HttpStatus.FORBIDDEN);
  });

  it('gerente y líder obtienen conteos distintos en /tablero/indicadores', async () => {
    const deGerente = await agenteGerente.get('/api/tablero/indicadores');
    const deLider = await agenteLider.get('/api/tablero/indicadores');

    expect(deGerente.status).toBe(HttpStatus.OK);
    expect(deLider.status).toBe(HttpStatus.OK);
    // El gerente ve todo el departamento (por territorio); el líder de
    // prueba, recién creado y sin red propia, no ve nada.
    expect(deGerente.body.simpatizantes_activos).toBeGreaterThan(deLider.body.simpatizantes_activos);
  });

  it('coordinadora -> 404 al usar como superior a alguien fuera de su red', async () => {
    // El gerente es su ANCESTRO, no parte de su propia red descendente
    // (campana.subordinados solo baja en el árbol): sirve igual de bien
    // que una cuenta de otra rama para probar el límite de mi_red().
    const res = await post(agenteCoordinadora, '/api/red/miembros', {
      documento: String(910_000_000 + Math.floor(Math.random() * 8_000_000)),
      nombres: 'PRUEBA E2E',
      apellidos: 'FUERA DE RED',
      cargo: 'LIDER',
      superiorId: cuentas.gerente.miembroId,
    });
    expect(res.status).toBe(HttpStatus.NOT_FOUND);
  });

  it('gerente -> 403 al asignar el rol SUPERADMIN', async () => {
    const res = await post(agenteGerente, '/api/usuarios', {
      login: `no-deberia-crearse-${Date.now()}@demo.co`,
      roles: ['SUPERADMIN'],
      territorioIds: [],
    });
    expect(res.status).toBe(HttpStatus.FORBIDDEN);
  });

  it('el registro público responde igual para una cédula nueva y una duplicada', async () => {
    const misLinks = await agenteLider.get('/api/red/mis-links');
    const codigoLink = (misLinks.body as { codigo: string; es_principal: boolean }[]).find((l) => l.es_principal)?.codigo;
    if (!codigoLink) throw new Error('El líder de prueba no tiene un link principal activo');

    const politica = await request(app.getHttpServer()).get('/api/registro/politica');
    const municipios = await request(app.getHttpServer()).get('/api/territorio/municipios');
    const territorioId = (municipios.body as { id: number }[])[0]?.id;
    if (!territorioId) throw new Error('No hay municipios cargados para la prueba');

    const documento = String(920_000_000 + Math.floor(Math.random() * 8_000_000));
    const cuerpoBase = {
      codigoLink,
      documento,
      // "PRUEBA E2E" en nombres: cuentas-prueba.ts borra por ese valor al terminar.
      nombres: 'PRUEBA E2E',
      apellidos: 'REGISTRO PUBLICO',
      territorioId,
      finalidades: ['ORGANIZACION_CAMPANA'],
      politicaVersion: politica.body.version,
      aceptaPolitica: true,
      canal: 'FORMULARIO_WEB' as const,
    };

    const primero = await post(request.agent(app.getHttpServer()), '/api/registro', cuerpoBase);
    const segundo = await post(request.agent(app.getHttpServer()), '/api/registro', cuerpoBase);

    expect(primero.status).toBe(HttpStatus.CREATED);
    expect(segundo.status).toBe(HttpStatus.CREATED);
    expect(segundo.body).toEqual(primero.body);
    expect(primero.body).toEqual({ resultado: 'RECIBIDO', mensaje: 'Gracias, tu registro fue recibido' });
  });

  it('un token de una sesión cerrada -> 401', async () => {
    const agenteTemporal = request.agent(app.getHttpServer());
    await iniciarSesionCompleta(agenteTemporal, cuentas.lider.login, cuentas.lider.clave);

    const salir = await post(agenteTemporal, '/api/auth/salir');
    expect(salir.status).toBe(HttpStatus.NO_CONTENT);

    const reintento = await agenteTemporal.get('/api/auth/yo');
    expect(reintento.status).toBe(HttpStatus.UNAUTHORIZED);
  });

  it('doble factor: verificar en una sesión nueva, y un código reutilizado se rechaza', async () => {
    if (!gerenteInfo.secretoBase32) throw new Error('No se guardó el secreto TOTP del gerente en el setup');

    // Sesión nueva: el factor ya está confirmado, pero esta sesión aún no lo verificó.
    const agenteNuevaSesion = request.agent(app.getHttpServer());
    const entrada = await post(agenteNuevaSesion, '/api/auth/login', { login: cuentas.gerente.login, clave: cuentas.gerente.clave });
    expect(entrada.body.estado).toBe('MFA_VERIFICAR');

    // Antes de verificar, una ruta normal debe seguir bloqueada con el estado pendiente.
    const bloqueado = await agenteNuevaSesion.get('/api/tablero/indicadores');
    expect(bloqueado.status).toBe(HttpStatus.FORBIDDEN);
    expect(bloqueado.body.estado).toBe('MFA_VERIFICAR');

    const codigo = codigoTotp(gerenteInfo.secretoBase32, 1);
    const verificar = await post(agenteNuevaSesion, '/api/auth/mfa/verificar', { codigo });
    expect(verificar.status).toBe(HttpStatus.CREATED);
    expect(verificar.body.estado).toBe('LISTO');

    const yaListo = await agenteNuevaSesion.get('/api/tablero/indicadores');
    expect(yaListo.status).toBe(HttpStatus.OK);

    // El mismo código (mismo paso de tiempo) ya no sirve.
    const reutilizado = await post(agenteNuevaSesion, '/api/auth/mfa/verificar', { codigo });
    expect(reutilizado.status).toBe(HttpStatus.UNAUTHORIZED);
  });

  it('un código de recuperación sirve una sola vez', async () => {
    const codigos = gerenteInfo.codigosRecuperacion;
    if (!codigos?.length) throw new Error('No se guardaron códigos de recuperación del gerente en el setup');
    const [codigo] = codigos;

    const primerUso = await post(agenteGerente, '/api/auth/mfa/recuperacion', { codigo });
    expect(primerUso.status).toBe(HttpStatus.CREATED);

    const segundoUso = await post(agenteGerente, '/api/auth/mfa/recuperacion', { codigo });
    expect(segundoUso.status).toBe(HttpStatus.UNAUTHORIZED);
  });

  // Al final: esta prueba cierra la sesión del líder al detectar la
  // reutilización, así que debe correr después de las demás que la usan.
  it('renovación: rota el token y la reutilización de uno viejo cierra la sesión', async () => {
    const cookieViejaRenovacion = liderInfo.renovacionInicial;
    if (!cookieViejaRenovacion) throw new Error('No se guardó la cookie de renovación inicial del líder en el setup');

    const primeraRenovacion = await post(agenteLider, '/api/auth/renovar');
    expect(primeraRenovacion.status).toBe(HttpStatus.OK);

    // Reutilizar la cookie de renovación YA ROTADA = señal de robo: 401 y la sesión se cierra.
    const reutilizada = await request(app.getHttpServer())
      .post('/api/auth/renovar')
      .set(CABECERA_CSRF)
      .set('Origin', ORIGEN)
      .set('Cookie', `campana_renovacion=${cookieViejaRenovacion}`);
    expect(reutilizada.status).toBe(HttpStatus.UNAUTHORIZED);

    // Incluso el token YA ROTADO (el legítimo) deja de servir: la sesión completa se cerró.
    const despuesDelRobo = await post(agenteLider, '/api/auth/renovar');
    expect(despuesDelRobo.status).toBe(HttpStatus.UNAUTHORIZED);
  });
});

describe('Bloqueo de cuenta por intentos fallidos', () => {
  // Cuenta propia dedicada solo a esta prueba (nunca lider*@demo.co): queda
  // bloqueada BLOQUEO_MINUTOS al terminar, pero como cuentas-prueba.ts la
  // borra por completo al final de la corrida, la próxima corrida arranca
  // con una cuenta nueva y sin ese bloqueo.
  let app: INestApplication;

  beforeAll(async () => {
    // El límite de 5 intentos de login por minuto (contra fuerza bruta desde
    // una sola IP) es una defensa aparte de la que se prueba aquí: el
    // bloqueo de LA CUENTA por intentos fallidos recientes. Se reemplaza el
    // almacenamiento del limitador por uno que nunca bloquea, para poder
    // hacer en esta instancia aislada los 6 intentos seguidos que exige esta
    // prueba sin que esa otra defensa interfiera.
    const almacenamientoSinLimite: ThrottlerStorage = {
      increment: async () => ({ totalHits: 1, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 }),
    };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue(almacenamientoSinLimite)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('seis intentos fallidos seguidos bloquean la cuenta (el sexto falla aunque la clave sea correcta)', async () => {
    for (let intento = 1; intento <= 5; intento++) {
      const res = await post(request.agent(app.getHttpServer()), '/api/auth/login', {
        login: cuentas.bloqueo.login,
        clave: 'clave-incorrecta-a-proposito',
      });
      expect(res.status).toBe(HttpStatus.UNAUTHORIZED);
    }
    // Sexto intento, ahora con la clave correcta: la cuenta ya está
    // bloqueada, así que debe seguir fallando con el mismo mensaje genérico.
    const sexto = await post(request.agent(app.getHttpServer()), '/api/auth/login', {
      login: cuentas.bloqueo.login,
      clave: cuentas.bloqueo.clave,
    });
    expect(sexto.status).toBe(HttpStatus.UNAUTHORIZED);
  }, 30_000);
});
