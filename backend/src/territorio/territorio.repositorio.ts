import { Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import type { DB } from '../database/db.types.js';

export interface ResultadoBusqueda {
  id: number;
  tipo: string;
  nombre: string;
  municipio: string | null;
  similitud: number;
}

/** Todas las consultas SQL del módulo de territorio. Sin reglas de negocio. */
@Injectable()
export class TerritorioRepositorio {
  async buscar(db: Kysely<DB>, texto: string, tipo: string | undefined, padre: number | undefined): Promise<ResultadoBusqueda[]> {
    const { rows } = await sql<ResultadoBusqueda>`
      select id, tipo, nombre, municipio, similitud
        from territorio.buscar(${texto}, ${tipo ?? null}, ${padre ?? null}::integer, 20)
    `.execute(db);
    return rows;
  }

  async municipios(db: Kysely<DB>) {
    const { rows } = await sql`
      select id, nombre, codigo_oficial
        from territorio.territorios
       where tipo_codigo = 'MUNICIPIO'
       order by nombre
    `.execute(db);
    return rows;
  }

  async puestos(db: Kysely<DB>, municipioId: number) {
    const { rows } = await sql`
      select p.id, p.nombre, p.direccion,
             ST_X(p.geom) as lon, ST_Y(p.geom) as lat
        from electoral.puestos_votacion p
       where territorio.ancestro(p.territorio_id, 'MUNICIPIO') = ${municipioId}
         and exists (
           select 1
             from electoral.puestos_jornada pj
             join electoral.jornadas j on j.id = pj.jornada_id
            where pj.puesto_id = p.id
              and j.id = (
                select id from electoral.jornadas order by fecha desc, id desc limit 1
              )
         )
       order by p.nombre
    `.execute(db);
    return rows;
  }

  contorno(db: Kysely<DB>) {
    return sql<{ geojson: unknown; bbox: number[] }>`
      select ST_AsGeoJSON(ST_SimplifyPreserveTopology(t.geom, 0.001), 6)::json as geojson,
             ARRAY[
               ST_XMin(ST_Envelope(t.geom)), ST_YMin(ST_Envelope(t.geom)),
               ST_XMax(ST_Envelope(t.geom)), ST_YMax(ST_Envelope(t.geom))
             ]::double precision[] as bbox
        from territorio.territorios t
       where t.tipo_codigo = 'DEPARTAMENTO'
       limit 1
    `
      .execute(db)
      .then((r) => r.rows[0]);
  }

  departamentoId(db: Kysely<DB>) {
    return db.selectFrom('territorio.territorios').select('id').where('tipo_codigo', '=', 'DEPARTAMENTO').executeTakeFirst();
  }

  /**
   * Debe ejecutarse dentro de comoUsuario(): m.simpatizantes y sin_acceso
   * dependen de campana.conteo_territorio_visible(), que lee app.usuario_id
   * (migración 20). Un territorio fuera del alcance del usuario llega con
   * simpatizantes NULL y sin_acceso true; el total del padre, igual, si el
   * propio padre no es visible.
   */
  /**
   * `tolerancia` (grados) simplifica los polígonos para que el mapa cargue
   * rápido: más alta para los municipios, más baja para veredas y comunas.
   * Las zonas sin polígono oficial (comunas, corregimientos) llegan con
   * geometry null: el mapa no las dibuja, pero sí las lista.
   */
  mapa(db: Kysely<DB>, padreId: number, tolerancia: number) {
    return sql<{ geojson: unknown; total_simpatizantes: number | null; total_sin_acceso: boolean }>`
      select json_build_object(
               'type', 'FeatureCollection',
               'features', coalesce(json_agg(json_build_object(
                   'type', 'Feature',
                   'id', m.id,
                   'geometry', case when m.geom is not null
                                    then ST_AsGeoJSON(ST_SimplifyPreserveTopology(m.geom, ${tolerancia}::float8), 6)::json end,
                   'properties', json_build_object(
                       'nombre', m.nombre,
                       'tipo', m.tipo_codigo,
                       'simpatizantes', m.simpatizantes,
                       'subdivisiones', m.subdivisiones,
                       'sinAcceso', m.sin_acceso)
               )), '[]'::json)
             ) as geojson,
             (select simpatizantes from campana.conteo_territorio_visible() where territorio_id = ${padreId}) as total_simpatizantes,
             (not exists (select 1 from campana.conteo_territorio_visible() where territorio_id = ${padreId})) as total_sin_acceso
        from territorio.v_mapa m
       where m.padre_id = ${padreId}
    `
      .execute(db)
      .then((r) => r.rows[0]);
  }
}
