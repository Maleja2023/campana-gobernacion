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

export interface Filtros {
  miembroId?: string;
  desde?: string;
  hasta?: string;
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

  /** Municipios con sus zonas (veredas, barrios, comunas...) y puestos de la
   * jornada vigente, en una sola consulta: es lo que el celular guarda para
   * registrar sin conexión. Solo datos públicos (DANE y Registraduría). */
  async catalogoRegistro(db: Kysely<DB>) {
    const { rows } = await sql<{ catalogo: unknown }>`
      with jornada as (select id from electoral.jornadas order by fecha desc, id desc limit 1)
      select coalesce(json_agg(json_build_object(
               'id', m.id,
               'nombre', m.nombre,
               'zonas', coalesce((
                 select json_agg(json_build_object('id', z.id, 'nombre', z.nombre, 'tipo', z.tipo_codigo) order by z.nombre)
                   from territorio.descendientes(m.id) d
                   join territorio.territorios z on z.id = d.territorio_id
                  where z.id <> m.id), '[]'::json),
               'puestos', coalesce((
                 select json_agg(json_build_object('id', p.id, 'nombre', p.nombre) order by p.nombre)
                   from electoral.puestos_votacion p
                  where territorio.ancestro(p.territorio_id, 'MUNICIPIO') = m.id
                    and exists (select 1 from electoral.puestos_jornada pj, jornada j
                                 where pj.puesto_id = p.id and pj.jornada_id = j.id)), '[]'::json)
             ) order by m.nombre), '[]'::json) as catalogo
        from territorio.territorios m
       where m.tipo_codigo = 'MUNICIPIO'
    `.execute(db);
    return rows[0].catalogo;
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
   * Debe ejecutarse dentro de comoUsuario(): los conteos salen de
   * campana.mapa_conteos() (migración 29), que respeta la seguridad por fila
   * (un coordinador cuenta solo su red) y aplica los filtros. Un territorio
   * fuera del alcance del usuario llega con simpatizantes null y sinAcceso
   * true; el total del padre, igual, si el propio padre no es visible.
   *
   * `tolerancia` (grados) simplifica los polígonos para que el mapa cargue
   * rápido: más alta para los municipios, más baja para veredas y comunas.
   * Las zonas sin polígono oficial (comunas, corregimientos) llegan con
   * geometry null: el mapa no las dibuja, pero sí las lista.
   */
  mapa(db: Kysely<DB>, padreId: number, tolerancia: number, f: Filtros) {
    return sql<{ geojson: unknown; total_simpatizantes: number | null; total_sin_acceso: boolean }>`
      with conteos as (
        select * from campana.mapa_conteos(${padreId}, ${f.miembroId ?? null}::uuid, ${f.desde ?? null}::date, ${f.hasta ?? null}::date)
      ), visibles as (
        select territorio_id from acceso.territorios_visibles()
      )
      select json_build_object(
               'type', 'FeatureCollection',
               'features', coalesce(json_agg(json_build_object(
                   'type', 'Feature',
                   'id', t.id,
                   'geometry', case when t.geom is not null
                                    then ST_AsGeoJSON(ST_SimplifyPreserveTopology(t.geom, ${tolerancia}::float8), 6)::json end,
                   'properties', json_build_object(
                       'nombre', t.nombre,
                       'tipo', t.tipo_codigo,
                       'simpatizantes', case when t.id in (select territorio_id from visibles) then c.simpatizantes end,
                       'subdivisiones', (select count(*) from territorio.territorios h where h.padre_id = t.id),
                       'sinAcceso', t.id not in (select territorio_id from visibles))
               )), '[]'::json)
             ) as geojson,
             (select c2.simpatizantes from conteos c2 where c2.territorio_id = ${padreId}
                 and ${padreId} in (select territorio_id from visibles)) as total_simpatizantes,
             (${padreId} not in (select territorio_id from visibles)) as total_sin_acceso
        from territorio.territorios t
        left join conteos c on c.territorio_id = t.id
       where t.padre_id = ${padreId}
    `
      .execute(db)
      .then((r) => r.rows[0]);
  }

  async calor(db: Kysely<DB>, municipioId: number | undefined, f: Filtros) {
    const { rows } = await sql<{ lat: number; lon: number; peso: number }>`
      select lat, lon, peso from campana.mapa_calor(${municipioId ?? null}::integer, ${f.miembroId ?? null}::uuid, ${f.desde ?? null}::date, ${f.hasta ?? null}::date)
    `.execute(db);
    return rows;
  }

  async necesidades(db: Kysely<DB>, padreId: number, categoria: string | undefined) {
    const { rows } = await sql<{ territorio_id: number; total: number; por_categoria: Record<string, number> }>`
      select territorio_id, total, por_categoria from participacion.mapa_necesidades(${padreId}, ${categoria ?? null})
    `.execute(db);
    return rows;
  }

  async brecha(db: Kysely<DB>, municipioId: number | undefined, f: Filtros) {
    const { rows } = await sql`
      select puesto_id, puesto, municipio_id, municipio, potencial_electoral, simpatizantes, cobertura_pct, lat, lon
        from campana.brecha_puestos(${municipioId ?? null}::integer, ${f.miembroId ?? null}::uuid, ${f.desde ?? null}::date, ${f.hasta ?? null}::date)
       order by municipio, puesto
    `.execute(db);
    return rows;
  }

  async miembrosFiltro(db: Kysely<DB>) {
    const { rows } = await sql`select miembro_id, nombre, cargo_codigo, municipio from campana.miembros_para_filtro()`.execute(db);
    return rows;
  }
}
