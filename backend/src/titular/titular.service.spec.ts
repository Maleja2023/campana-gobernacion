import type { Transaction } from 'kysely';
import type { UsuarioSesion } from '../auth/auth.types.js';
import { CifradoService } from '../cifrado/cifrado.service.js';
import { NoEncontradoError } from '../comun/errores/errores-dominio.js';
import type { DatabaseService } from '../database/database.service.js';
import type { DB } from '../database/db.types.js';
import { TitularService } from './titular.service.js';

const ACTOR: UsuarioSesion = { id: '11111111-1111-1111-1111-111111111111', login: 'gerente', sesionId: 's', estado: 'LISTO' };
const config = (valores: Record<string, string>) => ({ get: (k: string) => valores[k] }) as never;
const cifrado = new CifradoService(config({ PEPPER_HMAC: Buffer.alloc(32, 1).toString('base64'), LLAVE_CIFRADO: Buffer.alloc(32, 2).toString('base64') }));

describe('TitularService: derechos del titular', () => {
  const trx = {} as Transaction<DB>;
  const database = { comoUsuario: vi.fn(async (_id: string | null, fn: (t: Transaction<DB>) => unknown) => fn(trx)) };
  const captcha = { verificar: vi.fn(async () => undefined) };
  const repo = {
    radicar: vi.fn(async () => ({ radicado: 'T-2026-00001', fecha_limite: '2026-10-09' })),
    estado: vi.fn(async () => undefined as unknown),
    bajaPorDocumento: vi.fn(async () => undefined),
    datos: vi.fn(async () => null as unknown),
    bitacora: vi.fn(async () => [] as { total: number }[]),
  };
  const servicio = new TitularService(database as unknown as DatabaseService, cifrado, captcha as never, repo as never, config({}));

  beforeEach(() => vi.clearAllMocks());

  it('radicar exige captcha, actúa como anónimo y asocia por el hash de la cédula normalizada', async () => {
    const r = await servicio.radicar({ tipo: 'CONSULTA', documento: '1.117.000.123', contacto: ' a@b.co ', descripcion: ' hola ', captcha: 'tok' }, '1.2.3.4');

    expect(captcha.verificar).toHaveBeenCalledWith('tok', '1.2.3.4');
    expect(database.comoUsuario).toHaveBeenCalledWith(null, expect.any(Function));
    expect(repo.radicar).toHaveBeenCalledWith(trx, { tipo: 'CONSULTA', documentoHash: cifrado.hash('1117000123'), contacto: 'a@b.co', descripcion: 'hola' });
    expect(r).toEqual({ radicado: 'T-2026-00001', fechaLimite: '2026-10-09' });
  });

  it('estado con cédula equivocada responde "no encontrado" sin decir si el radicado existe', async () => {
    await expect(servicio.estado('t-2026-00001', '999')).rejects.toBeInstanceOf(NoEncontradoError);
    expect(repo.estado).toHaveBeenCalledWith(trx, 'T-2026-00001', cifrado.hash('999'));
  });

  it('la baja responde lo mismo exista o no la cédula', async () => {
    const r = await servicio.baja({ documento: '123', captcha: 'tok' }, null);
    expect(repo.bajaPorDocumento).toHaveBeenCalledWith(trx, cifrado.hash('123'), null);
    expect(r.mensaje).toMatch(/Si tus datos están/);
  });

  it('datos descifra cédula y teléfonos para responder al titular', async () => {
    repo.datos.mockResolvedValueOnce({
      nombres: 'Ana',
      documento_cifrado: cifrado.cifrar('123456').toString('base64'),
      telefonos_cifrados: [cifrado.cifrar('3001234567').toString('base64')],
    });
    await expect(servicio.datos(ACTOR, 'x')).resolves.toEqual({ nombres: 'Ana', documento: '123456', telefonos: ['3001234567'] });
    expect(database.comoUsuario).toHaveBeenCalledWith(ACTOR.id, expect.any(Function));
  });

  it('la bitácora pagina de a 50 y quita la columna total', async () => {
    repo.bitacora.mockResolvedValueOnce([{ total: 120, id: 1 } as never]);
    const r = await servicio.bitacora(ACTOR, { pagina: 3 } as never);
    expect(repo.bitacora).toHaveBeenCalledWith(trx, { pagina: 3 }, 50, 100);
    expect(r).toEqual({ datos: [{ id: 1 }], total: 120, pagina: 3, porPagina: 50 });
  });
});
