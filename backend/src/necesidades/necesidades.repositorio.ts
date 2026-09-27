import { Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import type { DB } from '../database/db.types.js';

/** Consultas de la Voz del territorio. Nunca devuelven quién reportó cada necesidad. */
@Injectable()
export class NecesidadesRepositorio {
  async porClasificar(db: Kysely<DB>, modelo: string, limite: number) {
    const { rows } = await sql<{ necesidad_id: string; descripcion: string; municipio: string | null }>`
      select necesidad_id, descripcion, municipio from participacion.necesidades_por_clasificar(${modelo}, ${limite})
    `.execute(db);
    return rows;
  }

  async guardarClasificacion(db: Kysely<DB>, necesidadId: string, categoria: string, modelo: string, confianza: number) {
    await sql`select participacion.guardar_clasificacion(${necesidadId}::uuid, ${categoria}, ${modelo}, ${confianza})`.execute(db);
  }

  async estado(db: Kysely<DB>, modelo: string) {
    const { rows } = await sql<{
      total: number;
      con_categoria_origen: number;
      clasificadas_modelo: number;
      clasificadas_reglas: number;
      pendientes_modelo: number;
    }>`select * from participacion.estado_clasificacion(${modelo})`.execute(db);
    return rows[0];
  }

  async listado(db: Kysely<DB>, municipioId: number | undefined, categoria: string | undefined, limite: number, desplazamiento: number) {
    const { rows } = await sql<Record<string, unknown> & { total: string }>`
      select * from participacion.listado_necesidades(${municipioId ?? null}::integer, ${categoria ?? null}, ${limite}, ${desplazamiento})
    `.execute(db);
    return rows;
  }

  async resumen(db: Kysely<DB>) {
    const { rows } = await sql<{ municipio_id: number | null; municipio: string | null; categoria: string; cantidad: number }>`
      select * from participacion.resumen_necesidades() order by municipio, cantidad desc
    `.execute(db);
    return rows;
  }

  async corregirCategoria(db: Kysely<DB>, necesidadId: string, categoria: string) {
    await sql`select participacion.corregir_categoria(${necesidadId}::uuid, ${categoria})`.execute(db);
  }

  async municipioVisible(db: Kysely<DB>, municipioId: number) {
    const { rows } = await sql<{ nombre: string }>`
      select t.nombre from territorio.territorios t
       where t.id = ${municipioId} and t.tipo_codigo = 'MUNICIPIO'
         and t.id in (select territorio_id from acceso.territorios_visibles())
    `.execute(db);
    return rows[0];
  }

  async insumoInforme(db: Kysely<DB>, municipioId: number) {
    const { rows } = await sql<{ categoria: string; territorio: string; descripcion: string; prioridad: string | null }>`
      select * from participacion.insumo_informe(${municipioId})
    `.execute(db);
    return rows;
  }

  async ultimoInforme(db: Kysely<DB>, municipioId: number) {
    const { rows } = await sql<{ id: number; generado_en: string; modelo: string; total_necesidades: number; contenido: string; generado_por: string }>`
      select i.id, i.generado_en, i.modelo, i.total_necesidades, i.contenido, u.login as generado_por
        from participacion.informes_necesidades i
        join acceso.usuarios u on u.id = i.generado_por
       where i.municipio_id = ${municipioId}
       order by i.generado_en desc
       limit 1
    `.execute(db);
    return rows[0] ?? null;
  }

  async guardarInforme(db: Kysely<DB>, datos: { municipioId: number; modelo: string; total: number; contenido: string }) {
    await sql`
      insert into participacion.informes_necesidades (municipio_id, generado_por, modelo, total_necesidades, contenido)
      values (${datos.municipioId}, acceso.usuario_actual(), ${datos.modelo}, ${datos.total}, ${datos.contenido})
    `.execute(db);
  }
}
