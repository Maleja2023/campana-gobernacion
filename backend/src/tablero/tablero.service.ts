import { BadRequestException, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DatabaseService } from '../database/database.service.js';
import type { UsuarioSesion } from '../auth/auth.types.js';

const DIAS_POR_DEFECTO = 30;
const DIAS_MAXIMOS = 366;

@Injectable()
export class TableroService {
  constructor(private readonly database: DatabaseService) {}

  async indicadores(usuario: UsuarioSesion) {
    return this.database.comoUsuario(usuario.id, async (trx) => {
      const { rows } = await sql`
        select simpatizantes_activos, registros_hoy, registros_semana,
               miembros_activos, alertas_abiertas, necesidades_reportadas
          from campana.v_tablero
      `.execute(trx);
      return rows[0];
    });
  }

  async registrosDiarios(usuario: UsuarioSesion, desde?: string, hasta?: string, municipioId?: number) {
    const rango = this.rangoFechas(desde, hasta);
    return this.database.comoUsuario(usuario.id, async (trx) => {
      const { rows } = await sql`
        select fecha, sum(registros)::integer as registros
          from campana.v_registros_diarios
         where fecha >= ${rango.desde}::date
           and fecha <= ${rango.hasta}::date
           and (${municipioId ?? null}::integer is null or municipio_id = ${municipioId ?? null}::integer)
         group by fecha
         order by fecha
      `.execute(trx);
      return rows;
    });
  }

  async ranking(usuario: UsuarioSesion, limite: number) {
    return this.database.comoUsuario(usuario.id, async (trx) => {
      const { rows } = await sql`
        select miembro_id, nombre, cargo_codigo, activos, ultimos_7_dias,
               ultimo_registro, intentos_duplicado
          from campana.v_ranking_miembros
         where cargo_codigo in ('LIDER', 'SUBLIDER')
         order by activos desc nulls last, nombre
         limit ${limite}
      `.execute(trx);
      return rows;
    });
  }

  async lideresInactivos(usuario: UsuarioSesion) {
    return this.database.comoUsuario(usuario.id, async (trx) => {
      const { rows } = await sql`
        select miembro_id, nombre, cargo_codigo, activos, ultimos_7_dias,
               ultimo_registro, intentos_duplicado
          from campana.v_lideres_inactivos
         order by nombre
      `.execute(trx);
      return rows;
    });
  }

  async metas(usuario: UsuarioSesion) {
    return this.database.comoUsuario(usuario.id, async (trx) => {
      const [miembros, territorios] = await Promise.all([
        sql`
          select m.miembro_id, r.nombre, m.meta, m.fecha_inicio, m.fecha_limite,
                 m.registrados, m.porcentaje
            from campana.v_avance_metas_miembro m
            left join campana.v_ranking_miembros r on r.miembro_id = m.miembro_id
           order by r.nombre
        `.execute(trx),
        sql`
          select territorio_id, territorio, meta, fecha_limite, registrados, porcentaje
            from campana.v_avance_metas_territorio
           order by territorio
        `.execute(trx),
      ]);
      return { miembros: miembros.rows, territorios: territorios.rows };
    });
  }

  async necesidades(usuario: UsuarioSesion, municipioId?: number) {
    return this.database.comoUsuario(usuario.id, async (trx) => {
      const [porMunicipio, sinPropuesta] = await Promise.all([
        sql`
          select n.municipio_id, t.nombre as municipio,
                 n.categoria_codigo, c.nombre as categoria, n.cantidad
            from participacion.v_necesidades_municipio n
            left join territorio.territorios t on t.id = n.municipio_id
            left join participacion.categorias_necesidad c on c.codigo = n.categoria_codigo
           where (${municipioId ?? null}::integer is null or n.municipio_id = ${municipioId ?? null}::integer)
           order by t.nombre, c.nombre
        `.execute(trx),
        sql`
          select codigo, nombre, necesidades
            from participacion.v_necesidades_sin_propuesta
           order by necesidades desc nulls last, nombre
        `.execute(trx),
      ]);
      return { porMunicipio: porMunicipio.rows, sinPropuesta: sinPropuesta.rows };
    });
  }

  async puestos(usuario: UsuarioSesion, municipioId?: number) {
    return this.database.comoUsuario(usuario.id, async (trx) => {
      const { rows } = await sql`
        select puesto_id, puesto, municipio_id, jornada_id, potencial_electoral,
               simpatizantes, cobertura_pct, ST_X(geom) as lon, ST_Y(geom) as lat
          from electoral.v_brecha_puestos
         where (${municipioId ?? null}::integer is null or municipio_id = ${municipioId ?? null}::integer)
         order by puesto
      `.execute(trx);
      return rows;
    });
  }

  private rangoFechas(desde?: string, hasta?: string): { desde: string; hasta: string } {
    const fin = hasta ? new Date(`${hasta}T00:00:00.000Z`) : new Date();
    const inicio = desde
      ? new Date(`${desde}T00:00:00.000Z`)
      : new Date(fin.getTime() - (DIAS_POR_DEFECTO - 1) * 24 * 60 * 60 * 1000);
    if (Number.isNaN(inicio.getTime()) || Number.isNaN(fin.getTime()) || inicio > fin) {
      throw new BadRequestException('El rango de fechas no es válido');
    }
    const dias = Math.floor((fin.getTime() - inicio.getTime()) / (24 * 60 * 60 * 1000)) + 1;
    if (dias > DIAS_MAXIMOS) throw new BadRequestException('El rango máximo es de 366 días');
    return { desde: inicio.toISOString().slice(0, 10), hasta: fin.toISOString().slice(0, 10) };
  }
}