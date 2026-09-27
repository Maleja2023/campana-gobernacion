import type { Transaction } from 'kysely';
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { UsuarioSesion } from '../auth/auth.types.js';
import { NoEncontradoError, ReglaNegocioError } from '../comun/errores/errores-dominio.js';
import type { DatabaseService } from '../database/database.service.js';
import type { DB } from '../database/db.types.js';
import { DiaDService, tipoImagen } from './dia-d.service.js';

const TESTIGO: UsuarioSesion = { id: '11111111-1111-1111-1111-111111111111', login: 'testigo', sesionId: 's', estado: 'LISTO' };
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100, 7)]);

describe('Día D: carga del E-14', () => {
  const trx = {} as Transaction<DB>;
  const database = { comoUsuario: vi.fn(async (_id: string | null, fn: (t: Transaction<DB>) => unknown) => fn(trx)) };
  const repo = {
    cargarE14: vi.fn(async () => ({ formulario_id: 'f1', estado_revision: 'PENDIENTE', total: 210 })),
    fotoE14: vi.fn(),
  };
  let directorio: string;
  let servicio: DiaDService;

  beforeEach(async () => {
    vi.clearAllMocks();
    directorio = await mkdtemp(join(tmpdir(), 'e14-'));
    servicio = new DiaDService(database as unknown as DatabaseService, repo as never, { get: () => directorio } as never);
  });

  it('reconoce el tipo de imagen por sus bytes, no por el nombre', () => {
    expect(tipoImagen(JPG)).toBe('jpg');
    expect(tipoImagen(Buffer.from('<svg onload=alert(1)>'))).toBeNull();
    expect(tipoImagen(Buffer.from('%PDF-1.7'))).toBeNull();
  });

  it('guarda la foto con su sha256 como nombre y pasa los votos a la base como el testigo', async () => {
    const r = await servicio.cargarE14(TESTIGO, { mesaId: 5, corporacion: 'GOBERNACION', votos: '{"1":120,"2":90}' }, { buffer: JPG, size: JPG.length });
    expect(r).toMatchObject({ formularioId: 'f1', estado: 'PENDIENTE', total: 210 });
    const [archivo] = await readdir(directorio);
    expect(archivo).toMatch(/^[0-9a-f]{64}\.jpg$/);
    expect(database.comoUsuario).toHaveBeenCalledWith(TESTIGO.id, expect.any(Function));
    expect(repo.cargarE14).toHaveBeenCalledWith(trx, 5, 'GOBERNACION', archivo, expect.any(Buffer), { 1: 120, 2: 90 });
  });

  it('rechaza archivos que no son imagen, sin foto o con votos inválidos', async () => {
    const dto = { mesaId: 5, corporacion: 'GOBERNACION', votos: '{"1":1}' };
    await expect(servicio.cargarE14(TESTIGO, dto, undefined)).rejects.toBeInstanceOf(ReglaNegocioError);
    const html = Buffer.from('<html></html>');
    await expect(servicio.cargarE14(TESTIGO, dto, { buffer: html, size: html.length })).rejects.toThrow('JPG, PNG o WEBP');
    await expect(servicio.cargarE14(TESTIGO, { ...dto, votos: '{"1":-3}' }, { buffer: JPG, size: JPG.length })).rejects.toThrow('enteros');
    expect(repo.cargarE14).not.toHaveBeenCalled();
  });

  it('no sirve la foto si fue modificada en el disco', async () => {
    await servicio.cargarE14(TESTIGO, { mesaId: 5, corporacion: 'GOBERNACION', votos: '{"1":1}' }, { buffer: JPG, size: JPG.length });
    const [archivo] = await readdir(directorio);
    const [, , , , sha256] = repo.cargarE14.mock.calls[0] as unknown as [unknown, number, string, string, Buffer];
    repo.fotoE14.mockResolvedValue({ ruta: archivo, sha256 });
    await expect(servicio.fotoE14(TESTIGO, 'f1')).resolves.toMatchObject({ contentType: 'image/jpeg' });
    await writeFile(join(directorio, archivo), Buffer.concat([await readFile(join(directorio, archivo)), Buffer.from('x')]));
    await expect(servicio.fotoE14(TESTIGO, 'f1')).rejects.toThrow('fue modificada');
    repo.fotoE14.mockResolvedValueOnce(undefined);
    await expect(servicio.fotoE14(TESTIGO, 'otro')).rejects.toBeInstanceOf(NoEncontradoError);
  });
});
