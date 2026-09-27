import { ConfigService } from '@nestjs/config';
import type { Transaction } from 'kysely';
import { CifradoService } from '../cifrado/cifrado.service.js';
import type { CaptchaService } from '../comun/captcha/captcha.service.js';
import { NoEncontradoError, ReglaNegocioError } from '../comun/errores/errores-dominio.js';
import type { DatabaseService } from '../database/database.service.js';
import type { DB } from '../database/db.types.js';
import type { UsuarioSesion } from '../auth/auth.types.js';
import type { EditarSimpatizanteDto } from './dto/editar-simpatizante.dto.js';
import type { ExportarSimpatizantesDto } from './dto/exportar-simpatizantes.dto.js';
import type { SimpatizantesRepositorio } from './simpatizantes.repositorio.js';
import { SimpatizantesService } from './simpatizantes.service.js';

// El armado del Excel se prueba aparte (exportar-excel.spec.ts). Aquí solo
// interesa CUÁNDO se construye: fuera de la transacción y después de auditar.
const { construirLibroMock } = vi.hoisted(() => ({ construirLibroMock: vi.fn() }));
vi.mock('./exportar-excel.js', () => ({ construirLibroSimpatizantes: construirLibroMock }));

const CLAVE = Buffer.alloc(32, 7).toString('base64');
const USUARIO: UsuarioSesion = {
  id: '11111111-2222-3333-4444-555555555555',
  login: 'lider',
  sesionId: '99999999-8888-7777-6666-555555555555',
  estado: 'LISTO',
};
const PERSONA = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

describe('SimpatizantesService', () => {
  const trxFalso = { marca: 'transaccion' } as unknown as Transaction<DB>;
  const cifrado = new CifradoService(new ConfigService({ PEPPER_HMAC: CLAVE, LLAVE_CIFRADO: CLAVE }));

  let transaccionAbierta: boolean;
  let abiertaAlAuditar: boolean | null;
  let abiertaAlConstruir: boolean | null;
  let ordenDeLlamadas: string[];

  const database = {
    comoUsuario: vi.fn(async (_usuarioId: string | null, fn: (trx: Transaction<DB>) => Promise<unknown>) => {
      transaccionAbierta = true;
      try {
        return await fn(trxFalso);
      } finally {
        transaccionAbierta = false;
      }
    }),
  };

  type Datos = Record<string, unknown>;

  const repo = {
    visible: vi.fn(async () => true),
    editar: vi.fn(async (_trx: unknown, _datos: Datos) => undefined),
    retirar: vi.fn(async () => undefined),
    reactivar: vi.fn(async () => undefined),
    historial: vi.fn(async () => [] as unknown[]),
    lideresParaRegistro: vi.fn(async () => [{ codigo_link: 'ABCD1234' }] as unknown[]),
    linkPrincipalDeUsuario: vi.fn(async () => undefined as { codigo: string } | undefined),
    jornadaMasReciente: vi.fn(async () => ({ id: 1 })),
    registrar: vi.fn(async (_trx: unknown, _datos: Datos) => ({ resultado: 'REGISTRADO', persona_id: PERSONA, mensaje: 'ok' })),
    descendientesDe: vi.fn(async () => [11, 12]),
    paraExportar: vi.fn(async () => [] as unknown[]),
    registrarExportacion: vi.fn(async (_trx: unknown, _datos: Datos) => {
      abiertaAlAuditar = transaccionAbierta;
      ordenDeLlamadas.push('auditar');
    }),
  };

  const captcha = { verificar: vi.fn(async () => undefined) };

  const servicio = new SimpatizantesService(
    database as unknown as DatabaseService,
    cifrado,
    repo as unknown as SimpatizantesRepositorio,
    captcha as unknown as CaptchaService,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    transaccionAbierta = false;
    abiertaAlAuditar = null;
    abiertaAlConstruir = null;
    ordenDeLlamadas = [];
    repo.visible.mockResolvedValue(true);
    repo.paraExportar.mockResolvedValue([]);
    construirLibroMock.mockImplementation(async () => {
      abiertaAlConstruir = transaccionAbierta;
      ordenDeLlamadas.push('construir');
      return Buffer.from('xlsx');
    });
  });

  const dtoEdicion = (extra: Partial<EditarSimpatizanteDto> = {}): EditarSimpatizanteDto =>
    ({ nombres: 'Ana', apellidos: 'Pérez', ...extra }) as EditarSimpatizanteDto;

  const datosEditados = () => repo.editar.mock.calls[0][1];

  describe('editar()', () => {
    it('lanza NoEncontradoError y no edita cuando la persona no es visible para el usuario', async () => {
      repo.visible.mockResolvedValue(false);

      await expect(servicio.editar(USUARIO, PERSONA, dtoEdicion())).rejects.toBeInstanceOf(NoEncontradoError);
      expect(repo.editar).not.toHaveBeenCalled();
    });

    it('edita cuando la persona sí es visible para el usuario', async () => {
      await expect(servicio.editar(USUARIO, PERSONA, dtoEdicion())).resolves.toEqual({ mensaje: 'Datos actualizados' });
      expect(repo.editar).toHaveBeenCalledTimes(1);
      expect(datosEditados().personaId).toBe(PERSONA);
    });

    it('abre la transacción con el id del usuario de la sesión (RLS)', async () => {
      await servicio.editar(USUARIO, PERSONA, dtoEdicion());

      expect(database.comoUsuario).toHaveBeenCalledWith(USUARIO.id, expect.any(Function));
      expect(repo.visible).toHaveBeenCalledWith(trxFalso, PERSONA);
      expect(repo.editar.mock.calls[0][0]).toBe(trxFalso);
    });

    it('cifra el teléfono y guarda un hash determinístico cuando el DTO lo trae', async () => {
      const espiaHash = vi.spyOn(cifrado, 'hash');
      const espiaCifrar = vi.spyOn(cifrado, 'cifrar');

      await servicio.editar(USUARIO, PERSONA, dtoEdicion({ telefono: '3001234567' }));

      const datos = datosEditados();
      expect(espiaHash).toHaveBeenCalledWith('3001234567');
      expect(espiaCifrar).toHaveBeenCalledWith('3001234567');
      expect(datos.telefonoHash).toEqual(cifrado.hash('3001234567'));
      expect(cifrado.descifrar(datos.telefonoCifrado as Buffer)).toBe('3001234567');
      espiaHash.mockRestore();
      espiaCifrar.mockRestore();
    });

    it('normaliza el teléfono antes de cifrarlo, para que el hash permita buscar por igualdad', async () => {
      await servicio.editar(USUARIO, PERSONA, dtoEdicion({ telefono: '300 123 4567' }));

      expect(datosEditados().telefonoHash).toEqual(cifrado.hash('3001234567'));
    });

    it('pasa telefonoHash y telefonoCifrado en null cuando el DTO no trae teléfono', async () => {
      const espiaCifrar = vi.spyOn(cifrado, 'cifrar');

      await servicio.editar(USUARIO, PERSONA, dtoEdicion());

      expect(datosEditados()).toMatchObject({ telefonoHash: null, telefonoCifrado: null });
      expect(espiaCifrar).not.toHaveBeenCalled();
      espiaCifrar.mockRestore();
    });

    it('recorta espacios en nombres y apellidos', async () => {
      await servicio.editar(USUARIO, PERSONA, dtoEdicion({ nombres: '  Ana María  ', apellidos: '  Pérez Gómez \n' }));

      expect(datosEditados()).toMatchObject({ nombres: 'Ana María', apellidos: 'Pérez Gómez' });
    });

    it('pasa territorioId en null cuando el DTO no lo trae (no cambiar)', async () => {
      await servicio.editar(USUARIO, PERSONA, dtoEdicion());

      expect(datosEditados().territorioId).toBeNull();
    });

    it('pasa el territorioId del DTO cuando sí lo trae', async () => {
      await servicio.editar(USUARIO, PERSONA, dtoEdicion({ territorioId: 42 }));

      expect(datosEditados().territorioId).toBe(42);
    });
  });

  describe('editar() parcial', () => {
    it('rechaza una edición sin ningún campo', async () => {
      await expect(servicio.editar(USUARIO, PERSONA, {} as EditarSimpatizanteDto)).rejects.toBeInstanceOf(ReglaNegocioError);
      expect(repo.editar).not.toHaveBeenCalled();
    });

    it('pasa en null los campos que no se envían y el puesto cuando sí se envía', async () => {
      await servicio.editar(USUARIO, PERSONA, { puestoId: 30 } as EditarSimpatizanteDto);

      expect(datosEditados()).toMatchObject({ nombres: null, apellidos: null, territorioId: null, puestoId: 30 });
    });
  });

  describe('retirar()', () => {
    it('lanza NoEncontradoError y no retira cuando la persona no es visible para el usuario', async () => {
      repo.visible.mockResolvedValue(false);

      await expect(servicio.retirar(USUARIO, PERSONA, 'Se mudó de municipio')).rejects.toBeInstanceOf(NoEncontradoError);
      expect(repo.retirar).not.toHaveBeenCalled();
    });

    it('retira con el motivo recortado, dentro de la transacción del usuario', async () => {
      await expect(servicio.retirar(USUARIO, PERSONA, '  Se mudó de municipio ')).resolves.toEqual({ mensaje: 'Simpatizante retirado' });

      expect(database.comoUsuario).toHaveBeenCalledWith(USUARIO.id, expect.any(Function));
      expect(repo.retirar).toHaveBeenCalledWith(trxFalso, PERSONA, 'Se mudó de municipio');
    });
  });

  describe('reactivar() e historial()', () => {
    it('no reactiva a una persona que no es visible', async () => {
      repo.visible.mockResolvedValue(false);

      await expect(servicio.reactivar(USUARIO, PERSONA)).rejects.toBeInstanceOf(NoEncontradoError);
      expect(repo.reactivar).not.toHaveBeenCalled();
    });

    it('no entrega el historial de una persona que no es visible', async () => {
      repo.visible.mockResolvedValue(false);

      await expect(servicio.historial(USUARIO, PERSONA)).rejects.toBeInstanceOf(NoEncontradoError);
      expect(repo.historial).not.toHaveBeenCalled();
    });
  });

  describe('autorregistro()', () => {
    it('no registra nada si el captcha falla', async () => {
      captcha.verificar.mockRejectedValueOnce(new ReglaNegocioError('captcha'));

      await expect(
        servicio.autorregistro({ captcha: 'x', codigoLink: 'ABCD1234' } as never, '1.2.3.4', null),
      ).rejects.toBeInstanceOf(ReglaNegocioError);
      expect(captcha.verificar).toHaveBeenCalledWith('x', '1.2.3.4');
      expect(repo.registrar).not.toHaveBeenCalled();
    });
  });

  describe('crear() con líder que refiere', () => {
    const dtoRegistro = (extra: Record<string, unknown> = {}) =>
      ({
        documento: '1234567',
        nombres: 'Ana',
        apellidos: 'Pérez',
        territorioId: 10,
        finalidades: ['ORGANIZACION_CAMPANA'],
        politicaVersion: 1,
        aceptaPolitica: true,
        canal: 'FORMULARIO_WEB',
        ...extra,
      }) as never;

    it('rechaza un líder que no está dentro del alcance del usuario', async () => {
      await expect(servicio.crear(dtoRegistro({ codigoLink: 'OTRO9999' }), USUARIO, null, null)).rejects.toBeInstanceOf(ReglaNegocioError);
      expect(repo.registrar).not.toHaveBeenCalled();
    });

    it('acepta un líder de su alcance aunque venga en minúsculas', async () => {
      await servicio.crear(dtoRegistro({ codigoLink: 'abcd1234' }), USUARIO, null, null);

      expect(repo.registrar.mock.calls[0][1]).toMatchObject({ codigoLink: 'ABCD1234', canal: 'DIGITADOR' });
    });

    it('pide elegir el líder cuando el usuario no tiene enlace propio', async () => {
      repo.linkPrincipalDeUsuario.mockResolvedValue(undefined);

      await expect(servicio.crear(dtoRegistro(), USUARIO, null, null)).rejects.toThrow('Elija el líder que refiere a la persona');
    });
  });

  describe('exportar()', () => {
    const dtoExporte = (extra: Partial<ExportarSimpatizantesDto> = {}): ExportarSimpatizantesDto =>
      ({ motivo: '  Auditoría interna  ', ...extra }) as ExportarSimpatizantesDto;

    const filas = [
      { nombres: 'Ana', municipio_id: 5 },
      { nombres: 'Beto', municipio_id: 5 },
      { nombres: 'Caro', municipio_id: 9 },
      { nombres: 'Dani', municipio_id: null },
    ];

    it('registra la exportación con motivo recortado, formato XLSX, cantidad real y municipios distintos sin nulos', async () => {
      repo.paraExportar.mockResolvedValue(filas);

      const resultado = await servicio.exportar(USUARIO, dtoExporte());

      expect(repo.registrarExportacion).toHaveBeenCalledWith(trxFalso, {
        motivo: 'Auditoría interna',
        formato: 'XLSX',
        cantidad: 4,
        territorios: [5, 9],
      });
      expect(resultado.cantidad).toBe(4);
    });

    it('registra territorios vacíos cuando ninguna fila tiene municipio', async () => {
      repo.paraExportar.mockResolvedValue([{ nombres: 'Ana', municipio_id: null }]);

      await servicio.exportar(USUARIO, dtoExporte());

      expect(repo.registrarExportacion.mock.calls[0][1]).toMatchObject({ cantidad: 1, territorios: [] });
    });

    it('lee las filas con el id del usuario de la sesión (RLS) y expande el territorio pedido', async () => {
      await servicio.exportar(USUARIO, dtoExporte({ territorioId: 7, estado: 'ACTIVO', texto: '  ana  ' }));

      expect(database.comoUsuario).toHaveBeenCalledWith(USUARIO.id, expect.any(Function));
      expect(repo.descendientesDe).toHaveBeenCalledWith(trxFalso, 7);
      expect(repo.paraExportar).toHaveBeenCalledWith(trxFalso, {
        municipioId: undefined,
        territoriosDescendientes: [11, 12],
        estado: 'ACTIVO',
        texto: 'ana',
      });
    });

    it('audita dentro de la transacción y construye el Excel fuera, después de auditar', async () => {
      repo.paraExportar.mockResolvedValue(filas);

      await servicio.exportar(USUARIO, dtoExporte());

      expect(abiertaAlAuditar).toBe(true);
      expect(abiertaAlConstruir).toBe(false);
      expect(ordenDeLlamadas).toEqual(['auditar', 'construir']);
      expect(construirLibroMock).toHaveBeenCalledWith(filas);
    });

    it('no entrega ningún archivo si falla el registro de auditoría', async () => {
      repo.paraExportar.mockResolvedValue(filas);
      repo.registrarExportacion.mockRejectedValueOnce(new Error('auditoría caída'));

      await expect(servicio.exportar(USUARIO, dtoExporte())).rejects.toThrow('auditoría caída');
      expect(construirLibroMock).not.toHaveBeenCalled();
    });
  });
});
