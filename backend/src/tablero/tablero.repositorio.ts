import { Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import type { DB } from '../database/db.types.js';

/** Todas las consultas SQL del módulo de tablero. Sin reglas de negocio. */
@Injectable()
export class TableroRepositorio {
  async indicadores(db: Kysely<DB>) {
    const { rows } = await sql`
      select simpatizantes_activos, registros_hoy, registros_semana,
             miembros_activos, alertas_abiertas, necesidades_reportadas
        from campana.v_tablero
    `.execute(db);
    return rows[0];
  }

  async registrosDiarios(db: Kysely<DB>, desde: string, hasta: string, municipioId?: number) {
    const { rows } = await sql`
      select fecha, sum(registros)::integer as registros
        from campana.v_registros_diarios
       where fecha >= ${desde}::date
         and fecha <= ${hasta}::date
         and (${municipioId ?? null}::integer is null or municipio_id = ${municipioId ?? null}::integer)
       group by fecha
       order by fecha
    `.execute(db);
    return rows;
  }

  async ranking(db: Kysely<DB>, limite: number) {
    const { rows } = await sql`
      select miembro_id, nombre, cargo_codigo, activos, ultimos_7_dias,
             ultimo_registro, intentos_duplicado
        from campana.v_ranking_miembros
       where cargo_codigo in ('LIDER', 'SUBLIDER')
       order by activos desc nulls last, nombre
       limit ${limite}
    `.execute(db);
    return rows;
  }

  async lideresInactivos(db: Kysely<DB>) {
    const { rows } = await sql`
      select miembro_id, nombre, cargo_codigo, activos, ultimos_7_dias,
             ultimo_registro, intentos_duplicado
        from campana.v_lideres_inactivos
       order by nombre
    `.execute(db);
    return rows;
  }

  async metasMiembro(db: Kysely<DB>) {
    const { rows } = await sql`
      select m.miembro_id, r.nombre, m.meta, m.fecha_inicio, m.fecha_limite,
             m.registrados, m.porcentaje
        from campana.v_avance_metas_miembro m
        left join campana.v_ranking_miembros r on r.miembro_id = m.miembro_id
       order by r.nombre
    `.execute(db);
    return rows;
  }

  async metasTerritorio(db: Kysely<DB>) {
    const { rows } = await sql`
      select territorio_id, territorio, meta, fecha_limite, registrados, porcentaje
        from campana.v_avance_metas_territorio
       order by territorio
    `.execute(db);
    return rows;
  }

  async necesidadesPorMunicipio(db: Kysely<DB>, municipioId?: number) {
    const { rows } = await sql`
      select n.municipio_id, t.nombre as municipio,
             n.categoria_codigo, c.nombre as categoria, n.cantidad
        from participacion.v_necesidades_municipio n
        left join territorio.territorios t on t.id = n.municipio_id
        left join participacion.categorias_necesidad c on c.codigo = n.categoria_codigo
       where (${municipioId ?? null}::integer is null or n.municipio_id = ${municipioId ?? null}::integer)
       order by t.nombre, c.nombre
    `.execute(db);
    return rows;
  }

  async necesidadesSinPropuesta(db: Kysely<DB>) {
    const { rows } = await sql`
      select codigo, nombre, necesidades
        from participacion.v_necesidades_sin_propuesta
       order by necesidades desc nulls last, nombre
    `.execute(db);
    return rows;
  }

  async puestos(db: Kysely<DB>, municipioId?: number) {
    const { rows } = await sql`
      select puesto_id, puesto, municipio_id, jornada_id, potencial_electoral,
             simpatizantes, cobertura_pct, ST_X(geom) as lon, ST_Y(geom) as lat
        from electoral.v_brecha_puestos
       where (${municipioId ?? null}::integer is null or municipio_id = ${municipioId ?? null}::integer)
       order by puesto
    `.execute(db);
    return rows;
  }
}
