import type { Transaction } from 'kysely';
import type { UsuarioSesion } from '../auth/auth.types.js';
import { ConflictoError, NoEncontradoError } from '../comun/errores/errores-dominio.js';
import type { DatabaseService } from '../database/database.service.js';
import type { DB } from '../database/db.types.js';
import type { CalidadRepositorio } from './calidad.repositorio.js';
import { CalidadService } from './calidad.service.js';
import type { ResolverAlertaDto } from './dto/resolver-alerta.dto.js';

const USUARIO: UsuarioSesion = {
  id: '11111111-2222-3333-4444-555555555555',
  login: 'calidad',
  sesionId: '99999999-8888-7777-6666-555555555555',
  estado: 'LISTO',
};
const ALERTA = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

describe('CalidadService', () => {
  const trxFalso = { marca: 'transaccion' } as unknown as Transaction<DB>;

  const database = {
    comoUsuario: vi.fn((_usuarioId: string | null, fn: (trx: Transaction<DB>) => Promise<unknown>) => fn(trxFalso)),
  };

  const repo = {
    listar: vi.fn(async () => [] as unknown[]),
    estadoDe: vi.fn(async () => 'ABIERTA' as string | undefined),
    personasDeAlerta: vi.fn(async () => [{ id: 'p1' }] as unknown[]),
    miembrosDeAlerta: vi.fn(async () => [{ id: 'm1' }] as unknown[]),
    resolver: vi.fn(async () => undefined),
  };

  const servicio = new CalidadService(database as unknown as DatabaseService, repo as unknown as CalidadRepositorio);

  const dto = (extra: Partial<ResolverAlertaDto> = {}): ResolverAlertaDto =>
    ({ estado: 'RESUELTA', observacion: 'Duplicado confirmado', ...extra }) as ResolverAlertaDto;

  beforeEach(() => {
    vi.clearAllMocks();
    repo.estadoDe.mockResolvedValue('ABIERTA');
  });

  describe('listar()', () => {
    it('sin filtro consulta solo las alertas pendientes (ABIERTA y EN_REVISION)', async () => {
      await servicio.listar(USUARIO);

      expect(repo.listar).toHaveBeenCalledWith(trxFalso, ['ABIERTA', 'EN_REVISION']);
    });

    it('con filtro consulta exactamente ese estado', async () => {
      await servicio.listar(USUARIO, 'DESCARTADA');

      expect(repo.listar).toHaveBeenCalledWith(trxFalso, ['DESCARTADA']);
    });

    it('consulta con el id del usuario de la sesión (RLS)', async () => {
      await servicio.listar(USUARIO);

      expect(database.comoUsuario).toHaveBeenCalledWith(USUARIO.id, expect.any(Function));
    });
  });

  describe('detalle()', () => {
    it('lanza NoEncontradoError cuando la alerta no existe o no es visible para el usuario', async () => {
      repo.estadoDe.mockResolvedValue(undefined);

      await expect(servicio.detalle(USUARIO, ALERTA)).rejects.toBeInstanceOf(NoEncontradoError);
      expect(repo.personasDeAlerta).not.toHaveBeenCalled();
      expect(repo.miembrosDeAlerta).not.toHaveBeenCalled();
    });

    it('devuelve personas y miembros cuando la alerta sí es visible', async () => {
      await expect(servicio.detalle(USUARIO, ALERTA)).resolves.toEqual({
        personas: [{ id: 'p1' }],
        miembros: [{ id: 'm1' }],
      });
      expect(database.comoUsuario).toHaveBeenCalledWith(USUARIO.id, expect.any(Function));
      expect(repo.estadoDe).toHaveBeenCalledWith(trxFalso, ALERTA);
    });
  });

  describe('resolver()', () => {
    it('lanza NoEncontradoError cuando la alerta no existe o no es visible para el usuario', async () => {
      repo.estadoDe.mockResolvedValue(undefined);

      await expect(servicio.resolver(USUARIO, ALERTA, dto())).rejects.toBeInstanceOf(NoEncontradoError);
      expect(repo.resolver).not.toHaveBeenCalled();
    });

    it.each(['RESUELTA', 'DESCARTADA'])(
      'lanza ConflictoError y no reescribe la observación si la alerta ya está en %s',
      async (estadoActual) => {
        repo.estadoDe.mockResolvedValue(estadoActual);

        await expect(servicio.resolver(USUARIO, ALERTA, dto())).rejects.toBeInstanceOf(ConflictoError);
        expect(repo.resolver).not.toHaveBeenCalled();
      },
    );

    it.each(['ABIERTA', 'EN_REVISION'])('resuelve una alerta en %s con el estado y la observación', async (estadoActual) => {
      repo.estadoDe.mockResolvedValue(estadoActual);

      await expect(servicio.resolver(USUARIO, ALERTA, dto())).resolves.toEqual({ mensaje: 'Alerta actualizada' });
      expect(repo.resolver).toHaveBeenCalledWith(trxFalso, ALERTA, 'RESUELTA', 'Duplicado confirmado');
    });

    it('resuelve con el id del usuario de la sesión (RLS)', async () => {
      await servicio.resolver(USUARIO, ALERTA, dto({ estado: 'DESCARTADA', observacion: 'Falso positivo' }));

      expect(database.comoUsuario).toHaveBeenCalledWith(USUARIO.id, expect.any(Function));
      expect(repo.resolver).toHaveBeenCalledWith(trxFalso, ALERTA, 'DESCARTADA', 'Falso positivo');
    });
  });
});
