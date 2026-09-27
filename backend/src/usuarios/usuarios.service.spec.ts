import type { Transaction } from 'kysely';
import type { UsuarioSesion } from '../auth/auth.types.js';
import { ReglaNegocioError } from '../comun/errores/errores-dominio.js';
import type { DatabaseService } from '../database/database.service.js';
import type { DB } from '../database/db.types.js';
import { UsuariosService } from './usuarios.service.js';

const ACTOR: UsuarioSesion = { id: '11111111-1111-1111-1111-111111111111', login: 'gerente', sesionId: 's', estado: 'LISTO' };
const OBJETIVO = '22222222-2222-2222-2222-222222222222';
const DEPARTAMENTO = 1;

describe('UsuariosService: reglas por rol', () => {
  const trx = {} as Transaction<DB>;
  const database = { comoUsuario: vi.fn(async (_id: string, fn: (t: Transaction<DB>) => unknown) => fn(trx)) };
  const repo = {
    usuarioPorId: vi.fn(async () => ({ activo: true })),
    rolesPermitidos: vi.fn(async () => ['CANDIDATO', 'COORDINADOR', 'LIDER', 'DIGITADOR']),
    rolesDeUsuario: vi.fn(async () => [] as { rol_codigo: string }[]),
    territoriosDeUsuario: vi.fn(async () => [] as { territorio_id: number }[]),
    territoriosVisiblesEntre: vi.fn(async (_t: unknown, ids: number[]) => ids),
    departamentoId: vi.fn(async () => DEPARTAMENTO),
    reemplazarRolesYTerritorios: vi.fn(async () => undefined),
    actualizarActivo: vi.fn(async () => undefined),
    cerrarSesionesDe: vi.fn(async () => undefined),
    esMunicipio: vi.fn(async (_t: unknown, id: number) => id === 2 || id === 3),
  };
  const servicio = new UsuariosService(database as unknown as DatabaseService, {} as never, repo as never, {} as never, {} as never);

  beforeEach(() => vi.clearAllMocks());

  it('al candidato se le asigna todo el departamento, aunque se envíe un municipio', async () => {
    const r = await servicio.actualizar(ACTOR, OBJETIVO, { roles: ['CANDIDATO'], territorioIds: [2] });

    expect(r.territorioIds).toEqual([DEPARTAMENTO]);
    expect(repo.reemplazarRolesYTerritorios).toHaveBeenCalledWith(trx, OBJETIVO, ['CANDIDATO'], [DEPARTAMENTO]);
  });

  it('el digitador debe tener al menos un territorio', async () => {
    await expect(servicio.actualizar(ACTOR, OBJETIVO, { roles: ['DIGITADOR'], territorioIds: [] })).rejects.toBeInstanceOf(ReglaNegocioError);
    expect(repo.reemplazarRolesYTerritorios).not.toHaveBeenCalled();
  });

  it('el líder no puede tener territorios (ve solo su red)', async () => {
    await expect(servicio.actualizar(ACTOR, OBJETIVO, { roles: ['LIDER'], territorioIds: [2] })).rejects.toBeInstanceOf(ReglaNegocioError);
  });

  it('el coordinador debe tener su municipio', async () => {
    await expect(servicio.actualizar(ACTOR, OBJETIVO, { roles: ['COORDINADOR'], territorioIds: [] })).rejects.toBeInstanceOf(ReglaNegocioError);
    await expect(servicio.actualizar(ACTOR, OBJETIVO, { roles: ['COORDINADOR'], territorioIds: [2] })).resolves.toMatchObject({ territorioIds: [2] });
  });

  it('el coordinador tiene un solo municipio, no varios ni una vereda', async () => {
    await expect(servicio.actualizar(ACTOR, OBJETIVO, { roles: ['COORDINADOR'], territorioIds: [2, 3] })).rejects.toThrow('un solo municipio');
    await expect(servicio.actualizar(ACTOR, OBJETIVO, { roles: ['COORDINADOR'], territorioIds: [500] })).rejects.toThrow('debe ser un municipio');
    expect(repo.reemplazarRolesYTerritorios).not.toHaveBeenCalled();
  });

  it('activar o desactivar a un coordinador antiguo no revalida su municipio', async () => {
    repo.rolesDeUsuario.mockResolvedValueOnce([{ rol_codigo: 'COORDINADOR' }]);
    repo.territoriosDeUsuario.mockResolvedValueOnce([{ territorio_id: 2 }, { territorio_id: 3 }]);
    await expect(servicio.actualizar(ACTOR, OBJETIVO, { activo: false })).resolves.toMatchObject({ activo: false });
    expect(repo.esMunicipio).not.toHaveBeenCalled();
  });
});
