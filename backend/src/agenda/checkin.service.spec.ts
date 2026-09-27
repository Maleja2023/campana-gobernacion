import type { Transaction } from 'kysely';
import type { UsuarioSesion } from '../auth/auth.types.js';
import { CifradoService } from '../cifrado/cifrado.service.js';
import { NoEncontradoError, ReglaNegocioError } from '../comun/errores/errores-dominio.js';
import type { DatabaseService } from '../database/database.service.js';
import type { DB } from '../database/db.types.js';
import { CheckinService } from './checkin.service.js';
import type { CheckinDto } from './dto/checkin.dto.js';

const ACTOR: UsuarioSesion = { id: '11111111-1111-1111-1111-111111111111', login: 'coord', sesionId: 's', estado: 'LISTO' };
const cifrado = new CifradoService({
  get: (k: string) => ({ PEPPER_HMAC: Buffer.alloc(32, 1).toString('base64'), LLAVE_CIFRADO: Buffer.alloc(32, 2).toString('base64') })[k],
} as never);
const DTO: CheckinDto = {
  documento: '1.117.000.123',
  nombres: ' Ana ',
  apellidos: 'Pérez',
  telefono: '3101234567',
  territorioId: 2,
  finalidades: ['ORGANIZACION_CAMPANA', 'EVENTOS'],
  politicaVersion: 1,
  aceptaPolitica: true,
};

describe('CheckinService: asistencia a eventos', () => {
  const trx = {} as Transaction<DB>;
  const database = { comoUsuario: vi.fn(async (_id: string | null, fn: (t: Transaction<DB>) => unknown) => fn(trx)) };
  const captcha = { verificar: vi.fn(async () => undefined) };
  const repo = {
    infoPublica: vi.fn(),
    checkinPublico: vi.fn(async (_t: unknown, _d: unknown) => 'REGISTRADO'),
    marcarAsistencia: vi.fn(),
    comparativo: vi.fn(async () => []),
  };
  const servicio = new CheckinService(database as unknown as DatabaseService, cifrado, captcha as never, repo as never);

  beforeEach(() => vi.clearAllMocks());

  it('el check-in exige captcha, actúa como anónimo y cifra cédula y celular', async () => {
    await expect(servicio.checkin('abc123xyz', DTO, '1.2.3.4', 'ua')).resolves.toEqual({ mensaje: expect.stringContaining('asistencia quedó registrada') });
    expect(captcha.verificar).toHaveBeenCalledWith(undefined, '1.2.3.4');
    expect(database.comoUsuario).toHaveBeenCalledWith(null, expect.any(Function));
    const d = repo.checkinPublico.mock.calls[0][1] as unknown as { codigo: string; documentoHash: Buffer; documentoCifrado: Buffer; nombres: string; telefonoHash: Buffer };
    expect(d.codigo).toBe('ABC123XYZ');
    expect(d.documentoHash).toEqual(cifrado.hash('1117000123'));
    expect(cifrado.descifrar(d.documentoCifrado)).toBe('1117000123');
    expect(d.telefonoHash).toEqual(cifrado.hash('3101234567'));
    expect(d.nombres).toBe('Ana');
  });

  it('responde lo mismo si la persona ya estaba o si es nueva', async () => {
    repo.checkinPublico.mockResolvedValueOnce('ASISTENCIA');
    const existente = await servicio.checkin('ABC123', DTO, null, null);
    const nueva = await servicio.checkin('ABC123', DTO, null, null);
    expect(existente).toEqual(nueva);
  });

  it('sin autorización o fuera de horario no registra', async () => {
    await expect(servicio.checkin('ABC123', { ...DTO, aceptaPolitica: false }, null, null)).rejects.toBeInstanceOf(ReglaNegocioError);
    expect(repo.checkinPublico).not.toHaveBeenCalled();
    repo.checkinPublico.mockResolvedValueOnce('FUERA_DE_HORARIO');
    await expect(servicio.checkin('ABC123', DTO, null, null)).rejects.toThrow('no está abierto');
  });

  it('un código con caracteres raros no llega a la base', async () => {
    await expect(servicio.info("x' or 1=1")).rejects.toBeInstanceOf(NoEncontradoError);
    expect(repo.infoPublica).not.toHaveBeenCalled();
  });

  it('la asistencia manual busca por hash de la cédula y avisa si no está en el alcance', async () => {
    repo.marcarAsistencia.mockResolvedValueOnce({ resultado: 'NO_ENCONTRADA', nombre: null });
    await expect(servicio.marcar(ACTOR, 'e1', '123.456')).rejects.toBeInstanceOf(NoEncontradoError);
    expect(repo.marcarAsistencia).toHaveBeenCalledWith(trx, 'e1', cifrado.hash('123456'));
  });

  it('el comparativo rechaza fechas invertidas', () => {
    expect(() => servicio.comparativo(ACTOR, { desde: '2026-09-10', hasta: '2026-09-01' })).toThrow(ReglaNegocioError);
  });
});
