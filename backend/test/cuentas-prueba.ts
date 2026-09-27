import pg from 'pg';
import { hashearClave } from '../src/auth/claves.js';

/**
 * Cuentas EXCLUSIVAS de las pruebas e2e de seguridad: nunca gerente@demo.co,
 * coord.*@demo.co ni lider*@demo.co (esas son de demostración). Se crean (si
 * no existen) al principio de la corrida con SQL directo por
 * CODEGEN_DATABASE_URL (el mismo superusuario que usa `npm run db:tipos`,
 * que se salta la seguridad por fila) y se borran por completo al final,
 * junto con sus sesiones, factores de doble factor y códigos de recuperación.
 *
 * Toda persona que crean estas pruebas tiene `nombres = 'PRUEBA E2E'`
 * (el apellido identifica cuál es); así el borrado final es un único
 * `DELETE ... WHERE nombres = 'PRUEBA E2E'` que también se lleva, por
 * `ON DELETE CASCADE`, cualquier simpatizante de prueba registrado durante
 * la corrida (por ejemplo el de la prueba de registro público).
 */

const NOMBRES_PRUEBA = 'PRUEBA E2E';

export function requerirEnv(nombre: string): string {
  const valor = process.env[nombre];
  if (!valor) {
    throw new Error(`Falta la variable de entorno ${nombre}. Configúrala en backend/.env (ver .env.example).`);
  }
  return valor;
}

export interface CuentaPrueba {
  login: string;
  clave: string;
  usuarioId: string;
  personaId: string;
  /** Ausente para cuentas que no son miembros de la estructura (ej. la de bloqueo). */
  miembroId?: string;
}

export interface CuentasPrueba {
  gerente: CuentaPrueba;
  coordinadora: CuentaPrueba;
  lider: CuentaPrueba;
  bloqueo: CuentaPrueba;
}

async function conectar(): Promise<pg.Client> {
  const cliente = new pg.Client({ connectionString: requerirEnv('CODEGEN_DATABASE_URL') });
  await cliente.connect();
  return cliente;
}

interface DefinicionPersona {
  login: string;
  clave: string;
  documento: string;
  apellidos: string;
}

async function crearPersonaYUsuario(
  cliente: pg.Client,
  def: DefinicionPersona,
): Promise<{ personaId: string; usuarioId: string }> {
  const claveHash = await hashearClave(def.clave);
  const persona = await cliente.query<{ id: string }>(
    `insert into personas.personas (tipo_documento_codigo, documento_hash, documento_cifrado, nombres, apellidos)
     values ('CC', digest($1, 'sha256'), convert_to('PRUEBA-' || $1, 'UTF8'), $2, $3)
     returning id`,
    [def.documento, NOMBRES_PRUEBA, def.apellidos],
  );
  const personaId = persona.rows[0].id;
  const usuario = await cliente.query<{ id: string }>(
    `insert into acceso.usuarios (persona_id, login, password_hash) values ($1, $2, $3) returning id`,
    [personaId, def.login, claveHash],
  );
  return { personaId, usuarioId: usuario.rows[0].id };
}

interface DefinicionMiembro extends DefinicionPersona {
  cargo: string;
  rol: string;
  superiorId?: string;
  territorioUsuarioId?: number;
  territorioMiembroId?: number;
}

/** Deja la cuenta lista para partir siempre del mismo estado: sin doble factor ni sesiones previas. */
async function reiniciarEstadoCuenta(cliente: pg.Client, usuarioId: string, clave: string): Promise<void> {
  const claveHash = await hashearClave(clave);
  await cliente.query(`update acceso.usuarios set password_hash = $2, activo = true where id = $1`, [usuarioId, claveHash]);
  await cliente.query(`delete from acceso.codigos_recuperacion where usuario_id = $1`, [usuarioId]);
  await cliente.query(`delete from acceso.factores_mfa where usuario_id = $1`, [usuarioId]);
  await cliente.query(`delete from acceso.sesiones where usuario_id = $1`, [usuarioId]);
}

/** Cuenta con miembro de la estructura (gerente, coordinadora, líder). */
async function asegurarCuentaMiembro(cliente: pg.Client, def: DefinicionMiembro): Promise<CuentaPrueba> {
  const existente = await cliente.query<{ usuario_id: string; persona_id: string; miembro_id: string }>(
    `select u.id as usuario_id, p.id as persona_id, m.id as miembro_id
       from acceso.usuarios u
       join personas.personas p on p.id = u.persona_id
       join campana.miembros m on m.persona_id = p.id
      where u.login = $1`,
    [def.login],
  );
  if (existente.rows[0]) {
    // Si una corrida anterior se interrumpió antes de borrar la cuenta, esta
    // puede traer un factor ya confirmado: se limpia para que el estado
    // tras el login sea siempre MFA_CONFIGURAR, igual que con una cuenta nueva.
    const fila = existente.rows[0];
    await reiniciarEstadoCuenta(cliente, fila.usuario_id, def.clave);
    return { login: def.login, clave: def.clave, usuarioId: fila.usuario_id, personaId: fila.persona_id, miembroId: fila.miembro_id };
  }

  const { personaId, usuarioId } = await crearPersonaYUsuario(cliente, def);

  const miembro = await cliente.query<{ id: string }>(
    `insert into campana.miembros (persona_id, cargo_codigo, superior_id) values ($1, $2, $3) returning id`,
    [personaId, def.cargo, def.superiorId ?? null],
  );
  const miembroId = miembro.rows[0].id;

  await cliente.query(`insert into acceso.usuario_roles (usuario_id, rol_codigo) values ($1, $2)`, [usuarioId, def.rol]);
  if (def.territorioUsuarioId !== undefined) {
    await cliente.query(`insert into acceso.usuario_territorios (usuario_id, territorio_id) values ($1, $2)`, [usuarioId, def.territorioUsuarioId]);
  }
  if (def.territorioMiembroId !== undefined) {
    await cliente.query(`insert into campana.miembro_territorios (miembro_id, territorio_id) values ($1, $2)`, [miembroId, def.territorioMiembroId]);
  }

  return { login: def.login, clave: def.clave, usuarioId, personaId, miembroId };
}

/** Cuenta sin posición en la red (la dedicada a la prueba de bloqueo por intentos fallidos). */
async function asegurarCuentaSimple(cliente: pg.Client, def: DefinicionPersona): Promise<CuentaPrueba> {
  const existente = await cliente.query<{ usuario_id: string; persona_id: string }>(
    `select u.id as usuario_id, p.id as persona_id from acceso.usuarios u join personas.personas p on p.id = u.persona_id where u.login = $1`,
    [def.login],
  );
  if (existente.rows[0]) {
    const fila = existente.rows[0];
    await reiniciarEstadoCuenta(cliente, fila.usuario_id, def.clave);
    return { login: def.login, clave: def.clave, usuarioId: fila.usuario_id, personaId: fila.persona_id };
  }
  const { personaId, usuarioId } = await crearPersonaYUsuario(cliente, def);
  return { login: def.login, clave: def.clave, usuarioId, personaId };
}

export async function crearCuentasPrueba(): Promise<CuentasPrueba> {
  const cliente = await conectar();
  try {
    const departamento = await cliente.query<{ id: number }>(
      `select id from territorio.territorios where tipo_codigo = 'DEPARTAMENTO' limit 1`,
    );
    const florencia = await cliente.query<{ id: number }>(
      `select id from territorio.territorios where codigo_oficial = '18001' limit 1`,
    );
    const departamentoId = departamento.rows[0]?.id;
    const florenciaId = florencia.rows[0]?.id;
    if (departamentoId === undefined || florenciaId === undefined) {
      throw new Error('No se encontró el territorio DEPARTAMENTO o el municipio 18001 (Florencia)');
    }

    // Gerente: mismo territorio (departamento completo) que gerente@demo.co,
    // sin superior (raíz de la estructura).
    const gerente = await asegurarCuentaMiembro(cliente, {
      login: requerirEnv('TEST_PRUEBA_GERENTE_LOGIN'),
      clave: requerirEnv('TEST_PRUEBA_GERENTE_CLAVE'),
      documento: '900000001',
      apellidos: 'GERENTE',
      cargo: 'GERENTE',
      rol: 'GERENTE',
      territorioUsuarioId: departamentoId,
    });

    // Coordinadora: mismo territorio (Florencia) que coord.florencia@demo.co,
    // bajo el gerente de prueba.
    const coordinadora = await asegurarCuentaMiembro(cliente, {
      login: requerirEnv('TEST_PRUEBA_COORDINADORA_LOGIN'),
      clave: requerirEnv('TEST_PRUEBA_COORDINADORA_CLAVE'),
      documento: '900000002',
      apellidos: 'COORDINADORA',
      cargo: 'COORDINADOR',
      rol: 'COORDINADOR',
      superiorId: gerente.miembroId,
      territorioUsuarioId: florenciaId,
      territorioMiembroId: florenciaId,
    });

    // Líder: bajo la coordinadora de prueba, sin territorio (ve por red, como lider1.florencia@demo.co).
    const lider = await asegurarCuentaMiembro(cliente, {
      login: requerirEnv('TEST_PRUEBA_LIDER_LOGIN'),
      clave: requerirEnv('TEST_PRUEBA_LIDER_CLAVE'),
      documento: '900000003',
      apellidos: 'LIDER',
      cargo: 'LIDER',
      rol: 'LIDER',
      superiorId: coordinadora.miembroId,
    });

    // Cuenta dedicada solo a la prueba de bloqueo: no necesita red ni rol,
    // solo existir con una contraseña conocida.
    const bloqueo = await asegurarCuentaSimple(cliente, {
      login: requerirEnv('TEST_PRUEBA_BLOQUEO_LOGIN'),
      clave: requerirEnv('TEST_PRUEBA_BLOQUEO_CLAVE'),
      documento: '900000004',
      apellidos: 'BLOQUEO',
    });

    return { gerente, coordinadora, lider, bloqueo };
  } finally {
    await cliente.end();
  }
}

export async function borrarCuentasPrueba(cuentas: CuentasPrueba): Promise<void> {
  const cliente = await conectar();
  try {
    // `auditoria.eventos` es inmutable (trg_auditoria_inmutable bloquea todo
    // UPDATE/DELETE) y `usuario_id` tiene ON DELETE SET NULL: borrar el
    // usuario dispara ese UPDATE y chocaría con el trigger. Se desactiva
    // solo mientras dura ESTA transacción — ALTER TABLE ... TRIGGER es DDL
    // transaccional, así que un error antes del COMMIT deshace también la
    // desactivación y el trigger queda como estaba.
    await cliente.query('BEGIN');
    await cliente.query('ALTER TABLE auditoria.eventos DISABLE TRIGGER trg_auditoria_inmutable');

    const personaIdsCuentas = [cuentas.gerente.personaId, cuentas.coordinadora.personaId, cuentas.lider.personaId, cuentas.bloqueo.personaId];

    // Fase 1: cualquier OTRA persona de prueba (ej. el simpatizante que creó
    // la prueba de registro público, usando el link del líder) tiene
    // nombres = 'PRUEBA E2E' y se borra PRIMERO — así ON DELETE CASCADE se
    // lleva su fila de campana.simpatizantes antes de que, más abajo, se
    // intente borrar el links_referido que esa fila todavía referenciaría.
    await cliente.query(`delete from personas.personas where nombres = $1 and id <> all($2::uuid[])`, [
      NOMBRES_PRUEBA,
      personaIdsCuentas,
    ]);

    // Fase 2: las 4 cuentas propias. Hijos primero (líder -> coordinadora ->
    // gerente; bloqueo no tiene superior): `superior_id` no tiene
    // ON DELETE CASCADE.
    for (const cuenta of [cuentas.lider, cuentas.coordinadora, cuentas.gerente, cuentas.bloqueo]) {
      await cliente.query(`delete from acceso.codigos_recuperacion where usuario_id = $1`, [cuenta.usuarioId]);
      await cliente.query(`delete from acceso.factores_mfa where usuario_id = $1`, [cuenta.usuarioId]);
      await cliente.query(`delete from acceso.sesiones where usuario_id = $1`, [cuenta.usuarioId]);
      await cliente.query(`delete from acceso.usuario_roles where usuario_id = $1`, [cuenta.usuarioId]);
      await cliente.query(`delete from acceso.usuario_territorios where usuario_id = $1`, [cuenta.usuarioId]);
      if (cuenta.miembroId) {
        await cliente.query(`delete from campana.miembro_territorios where miembro_id = $1`, [cuenta.miembroId]);
        await cliente.query(`delete from campana.links_referido where miembro_id = $1`, [cuenta.miembroId]);
      }
      await cliente.query(`delete from acceso.usuarios where id = $1`, [cuenta.usuarioId]);
      if (cuenta.miembroId) {
        await cliente.query(`delete from campana.miembros where id = $1`, [cuenta.miembroId]);
      }
      await cliente.query(`delete from personas.personas where id = $1`, [cuenta.personaId]);
    }

    await cliente.query('ALTER TABLE auditoria.eventos ENABLE TRIGGER trg_auditoria_inmutable');
    await cliente.query('COMMIT');
  } catch (error) {
    await cliente.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await cliente.end();
  }
}

export { NOMBRES_PRUEBA };
