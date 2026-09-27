import { Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import type { DB } from '../database/db.types.js';
import type { ReporteQueryDto } from './dto/reportes.dto.js';

/** Consultas de reportes. Todas dentro de comoUsuario(): cada usuario ve su alcance. */
@Injectable()
export class ReportesRepositorio {
  async municipios(db: Kysely<DB>, f: ReporteQueryDto) {
    const { rows } = await sql<Record<string, unknown> & { municipio_id: number }>`
      select * from campana.reporte_municipios(${f.desde ?? null}::date, ${f.hasta ?? null}::date)
       where (${f.municipioId ?? null}::integer is null or municipio_id = ${f.municipioId ?? null}::integer)
       order by simpatizantes desc, municipio
    `.execute(db);
    return rows;
  }

  async lideres(db: Kysely<DB>, f: ReporteQueryDto) {
    const { rows } = await sql<Record<string, unknown>>`
      select * from campana.reporte_lideres(${f.municipioId ?? null}::integer, ${f.desde ?? null}::date, ${f.hasta ?? null}::date)
       where (${f.miembroId ?? null}::uuid is null
              or miembro_id in (select miembro_id from campana.subordinados(${f.miembroId ?? null}::uuid)))
       order by red desc, nombre
    `.execute(db);
    return rows;
  }

  async puestos(db: Kysely<DB>, f: ReporteQueryDto) {
    const { rows } = await sql<Record<string, unknown> & { municipio_id: number }>`
      select puesto_id, puesto, municipio_id, municipio, potencial_electoral, simpatizantes, cobertura_pct,
             case when potencial_electoral is not null then greatest(potencial_electoral - simpatizantes, 0) end as faltan
        from campana.brecha_puestos(${f.municipioId ?? null}::integer, ${f.miembroId ?? null}::uuid, ${f.desde ?? null}::date, ${f.hasta ?? null}::date)
       order by municipio, simpatizantes desc, puesto
    `.execute(db);
    return rows;
  }

  async proyeccion(db: Kysely<DB>) {
    const { rows } = await sql<Record<string, unknown>>`
      select * from campana.proyeccion_metas()
       order by case estado when 'NO_ALCANZA' then 0 when 'EN_RIESGO' then 1 when 'VENCIDA' then 2 when 'EN_CAMINO' then 3 else 4 end,
                proyectado_pct nulls last, nombre
    `.execute(db);
    return rows;
  }

  async registrarExportacion(db: Kysely<DB>, datos: { motivo: string; cantidad: number; territorios: number[]; recurso: string }) {
    await sql`
      select auditoria.registrar_exportacion(${datos.motivo}, 'XLSX', ${datos.cantidad}, ${sql.val(datos.territorios)}::integer[], ${datos.recurso})
    `.execute(db);
  }

  async bitacora(db: Kysely<DB>, limite: number) {
    const { rows } = await sql`select * from auditoria.bitacora_exportaciones(${limite})`.execute(db);
    return rows;
  }
}
