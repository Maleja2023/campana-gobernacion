import 'reflect-metadata';
import type { Transaction } from 'kysely';
import type { UsuarioSesion } from '../auth/auth.types.js';
import { ReglaNegocioError } from '../comun/errores/errores-dominio.js';
import type { DatabaseService } from '../database/database.service.js';
import type { DB } from '../database/db.types.js';
import { ReportesService } from './reportes.service.js';

const USUARIO: UsuarioSesion = { id: '11111111-1111-1111-1111-111111111111', login: 'gerente', sesionId: 's', estado: 'LISTO' };

describe('ReportesService', () => {
  const trx = {} as Transaction<DB>;
  const database = { comoUsuario: vi.fn(async (_id: string, fn: (t: Transaction<DB>) => unknown) => fn(trx)) };
  const repo = {
    municipios: vi.fn(async () => [
      { municipio_id: 2, municipio: 'FLORENCIA', simpatizantes: 360, avance_pct: '34.3' },
      { municipio_id: 7, municipio: '=HYPERLINK("x")', simpatizantes: 5, avance_pct: null },
    ]),
    lideres: vi.fn(async () => []),
    puestos: vi.fn(async () => []),
    proyeccion: vi.fn(async () => []),
    registrarExportacion: vi.fn(async () => undefined),
    bitacora: vi.fn(async () => []),
  };
  const servicio = new ReportesService(database as unknown as DatabaseService, repo as never);

  beforeEach(() => vi.clearAllMocks());

  it('exportar registra motivo, cantidad, municipios y el reporte en la bitácora, y devuelve un xlsx', async () => {
    const r = await servicio.exportar(USUARIO, { reporte: 'MUNICIPIOS', motivo: '  Informe semanal  ' });

    expect(repo.registrarExportacion).toHaveBeenCalledWith(trx, {
      motivo: 'Informe semanal',
      cantidad: 2,
      territorios: [2, 7],
      recurso: 'REPORTE_MUNICIPIOS',
    });
    expect(r.cantidad).toBe(2);
    expect(r.nombre).toBe('reporte-municipios.xlsx');
    // Un .xlsx es un zip: empieza por "PK".
    expect(r.buffer.subarray(0, 2).toString()).toBe('PK');
  });

  it('rechaza un rango de fechas invertido antes de consultar', async () => {
    expect(() => servicio.municipios(USUARIO, { desde: '2026-09-10', hasta: '2026-09-01' })).toThrow(ReglaNegocioError);
    await expect(servicio.exportar(USUARIO, { reporte: 'LIDERES', motivo: 'Revisión', desde: '2026-09-10', hasta: '2026-09-01' })).rejects.toBeInstanceOf(
      ReglaNegocioError,
    );
    expect(repo.registrarExportacion).not.toHaveBeenCalled();
  });
});
