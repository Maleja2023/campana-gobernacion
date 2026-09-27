import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { sql } from 'kysely';
import { Publico } from '../auth/decoradores.js';
import { DatabaseService } from '../database/database.service.js';

/** Un objeto que crea cada migración: si falta, esa migración no se ha ejecutado. */
const MIGRACIONES: [string, string][] = [
  ['24_historial_y_registro.sql', "to_regclass('campana.historial_simpatizante')"],
  ['25_registro_sin_conexion.sql', "to_regprocedure('campana.fn_autorizacion_hora_captura()')"],
  ['26_alcance_red.sql', "to_regprocedure('campana.miembros_visibles()')"],
  ['27_coordinador_por_municipio.sql', "to_regprocedure('campana.municipio_id_de_miembro(uuid)')"],
  ['28_coordinador_ve_su_red.sql', "to_regprocedure('acceso.alcance_solo_red()')"],
  ['29_mapas.sql', "to_regprocedure('campana.mapa_conteos(integer,uuid,date,date)')"],
  ['30_tablero_reportes.sql', "to_regprocedure('campana.indicadores_tablero()')"],
  ['31_calidad.sql', "to_regprocedure('calidad.puntaje_lideres()')"],
  ['32_necesidades_ia.sql', "to_regprocedure('participacion.resumen_necesidades()')"],
  ['33_enlace_lideres.sql', "to_regprocedure('campana.mi_enlace_lideres()')"],
];

@Controller('salud')
export class SaludController {
  constructor(private readonly database: DatabaseService) {}

  /** Verifica que la API y la base de datos respondan. */
  @Publico()
  @Get()
  async revisar() {
    try {
      const { rows } = await sql<{ usuario: string; postgis: string }>`
        select current_user as usuario, postgis_lib_version() as postgis
      `.execute(this.database.db);
      const { rows: objetos } = await sql<Record<string, string | null>>`
        select ${sql.raw(MIGRACIONES.map(([, expr], i) => `${expr}::text as m${i}`).join(', '))}
      `.execute(this.database.db);
      const pendientes = MIGRACIONES.filter((_, i) => objetos[0][`m${i}`] === null).map(([archivo]) => archivo);
      return {
        api: 'ok',
        baseDatos: 'ok',
        usuarioBaseDatos: rows[0].usuario,
        postgis: rows[0].postgis,
        // Scripts de database/ que faltan por ejecutar (con \i, como postgres).
        migracionesPendientes: pendientes,
      };
    } catch {
      throw new ServiceUnavailableException({ api: 'ok', baseDatos: 'sin conexión' });
    }
  }
}
