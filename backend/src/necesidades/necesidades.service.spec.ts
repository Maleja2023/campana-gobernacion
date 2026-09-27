import 'reflect-metadata';
import type { DatabaseService } from '../database/database.service.js';
import type { IaService } from './ia.service.js';
import { MODELO_REGLAS, NecesidadesService } from './necesidades.service.js';

function pendientes(n: number) {
  return Array.from({ length: n }, (_, i) => ({ necesidad_id: `id-${i}`, descripcion: i % 2 ? 'No hay señal de internet' : 'La vía está mala', municipio: 'FLORENCIA' }));
}

describe('NecesidadesService: clasificación', () => {
  const db = {};
  const database = { db, comoUsuario: vi.fn() };
  const repo = { porClasificar: vi.fn(), guardarClasificacion: vi.fn(async () => undefined) };

  beforeEach(() => vi.clearAllMocks());

  it('sin IA configurada clasifica con reglas y guarda con el modelo de reglas', async () => {
    repo.porClasificar.mockResolvedValue(pendientes(2));
    const ia = { disponible: false } as IaService;
    const servicio = new NecesidadesService(database as unknown as DatabaseService, repo as never, ia);

    const r = await servicio.clasificarPendientes();

    expect(repo.porClasificar).toHaveBeenCalledWith(db, MODELO_REGLAS, 200);
    expect(repo.guardarClasificacion).toHaveBeenCalledWith(db, 'id-0', 'VIAS', MODELO_REGLAS, 0.5);
    expect(repo.guardarClasificacion).toHaveBeenCalledWith(db, 'id-1', 'CONECTIVIDAD', MODELO_REGLAS, 0.5);
    expect(r).toEqual({ modelo: MODELO_REGLAS, clasificadas: 2, fallidas: 0 });
  });

  it('con IA clasifica por lotes de 25 y asigna cada resultado a su necesidad por índice', async () => {
    repo.porClasificar.mockResolvedValue(pendientes(30));
    const clasificar = vi.fn(async (lote: { indice: number }[]) =>
      // La IA devuelve un índice de menos: esa necesidad cuenta como fallida y se reintenta después.
      lote.slice(1).map((n) => ({ indice: n.indice, categoria: 'SALUD' as const, confianza: 0.9 })),
    );
    const ia = { disponible: true, modelo: 'claude-opus-5', clasificar } as unknown as IaService;
    const servicio = new NecesidadesService(database as unknown as DatabaseService, repo as never, ia);

    const r = await servicio.clasificarPendientes();

    expect(clasificar).toHaveBeenCalledTimes(2);
    expect(clasificar.mock.calls[0][0]).toHaveLength(25);
    expect(clasificar.mock.calls[1][0]).toHaveLength(5);
    expect(repo.guardarClasificacion).toHaveBeenCalledWith(db, 'id-26', 'SALUD', 'claude-opus-5', 0.9);
    expect(repo.guardarClasificacion).not.toHaveBeenCalledWith(db, 'id-25', expect.anything(), 'claude-opus-5', expect.anything());
    expect(r).toEqual({ modelo: 'claude-opus-5', clasificadas: 28, fallidas: 2 });
  });

  it('si la IA falla (sin red, sin saldo) se detiene y deja el resto pendiente', async () => {
    repo.porClasificar.mockResolvedValue(pendientes(60));
    const clasificar = vi.fn(async () => {
      throw new Error('Connection error');
    });
    const ia = { disponible: true, modelo: 'claude-opus-5', clasificar } as unknown as IaService;
    const servicio = new NecesidadesService(database as unknown as DatabaseService, repo as never, ia);

    const r = await servicio.clasificarPendientes();

    expect(clasificar).toHaveBeenCalledTimes(1);
    expect(r.fallidas).toBe(25);
    // Mientras tanto, las reglas clasifican lo pendiente.
    expect(repo.porClasificar).toHaveBeenLastCalledWith(db, MODELO_REGLAS, 200);
    expect(repo.guardarClasificacion).toHaveBeenCalledWith(db, 'id-0', 'VIAS', MODELO_REGLAS, 0.5);
    expect(repo.guardarClasificacion).not.toHaveBeenCalledWith(db, expect.anything(), expect.anything(), 'claude-opus-5', expect.anything());
  });
});
