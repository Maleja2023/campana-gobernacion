import { Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'kysely';
import { DatabaseService } from '../database/database.service.js';

export interface ResultadoBusqueda {
  id: number;
  tipo: string;
  nombre: string;
  municipio: string | null;
  similitud: number;
}

@Injectable()
export class TerritorioService {
  constructor(private readonly database: DatabaseService) {}

  /** Buscador tolerante a tildes y errores (usa territorio.buscar). */
  async buscar(texto: string, tipo?: string, padre?: number): Promise<ResultadoBusqueda[]> {
    const { rows } = await sql<ResultadoBusqueda>`
      select id, tipo, nombre, municipio, similitud
        from territorio.buscar(${texto}, ${tipo ?? null}, ${padre ?? null}::integer, 20)
    `.execute(this.database.db);
    return rows;
  }

  /** Municipios del departamento (id y nombre), para listas y filtros. */
  async municipios() {
    return this.database.db
      .selectFrom('territorio.territorios')
      .select(['id', 'nombre'])
      .where('tipo_codigo', '=', 'MUNICIPIO')
      .orderBy('nombre')
      .execute();
  }

  /**
   * GeoJSON de los hijos de un territorio con su conteo de simpatizantes.
   * Sin `padre`, devuelve los municipios del departamento.
   * Las zonas sin polígono (comunas, corregimientos) vienen con geometry null
   * para que el frontend pueda listarlas aunque no se dibujen.
   */
  async mapa(padre?: number) {
    const padreId =
      padre ??
      (
        await this.database.db
          .selectFrom('territorio.territorios')
          .select('id')
          .where('tipo_codigo', '=', 'DEPARTAMENTO')
          .executeTakeFirst()
      )?.id;

    if (padreId === undefined) {
      throw new NotFoundException('No hay territorio cargado');
    }

    // Menos detalle en los polígonos grandes para que el mapa cargue rápido.
    const { rows } = await sql<{ geojson: unknown }>`
      select json_build_object(
               'type', 'FeatureCollection',
               'features', coalesce(json_agg(json_build_object(
                   'type', 'Feature',
                   'id', m.id,
                   'geometry', case when m.geom is not null
                                    then ST_AsGeoJSON(ST_SimplifyPreserveTopology(m.geom, 0.0005), 6)::json end,
                   'properties', json_build_object(
                       'nombre', m.nombre,
                       'tipo', m.tipo_codigo,
                       'simpatizantes', m.simpatizantes,
                       'subdivisiones', m.subdivisiones)
               )), '[]'::json)
             ) as geojson
        from territorio.v_mapa m
       where m.padre_id = ${padreId}
    `.execute(this.database.db);

    return rows[0].geojson;
  }
}
