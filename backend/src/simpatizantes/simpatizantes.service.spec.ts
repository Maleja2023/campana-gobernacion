import { ConfigService } from '@nestjs/config';
import type { Transaction } from 'kysely';
import { CifradoService } from '../cifrado/cifrado.service.js';
import { NoEncontradoError } from '../comun/errores/errores-dominio.js';
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
    descendientesDe: vi.fn(async () => [11, 12]),
    paraExportar: vi.fn(async () => [] as unknown[]),
    registrarExportacion: vi.fn(async (_trx: unknown, _datos: Datos) => {
      abiertaAlAuditar = transaccionAbierta;
      ordenDeLlamadas.push('auditar');
    }),
  };

  const servicio = new SimpatizantesService(
    database as unknown as DatabaseService,
    cifrado,
    repo as unknown as SimpatizantesRepositorio,
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

  describe('retirar()', () => {
    it('lanza NoEncontradoError y no retira cuando la persona no es visible para el usuario', async () => {
      repo.visible.mockResolvedValue(false);

      await expect(servicio.retirar(USUARIO, PERSONA)).rejects.toBeInstanceOf(NoEncontradoError);
      expect(repo.retirar).not.toHaveBeenCalled();
    });

    it('retira cuando la persona sí es visible, dentro de la transacción del usuario', async () => {
      await expect(servicio.retirar(USUARIO, PERSONA)).resolves.toEqual({ mensaje: 'Simpatizante retirado' });

      expect(database.comoUsuario).toHaveBeenCalledWith(USUARIO.id, expect.any(Function));
      expect(repo.retirar).toHaveBeenCalledWith(trxFalso, PERSONA);
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
