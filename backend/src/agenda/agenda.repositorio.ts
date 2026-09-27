import { Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import type { DB } from '../database/db.types.js';
import type { CompromisoDto, CompromisosQueryDto, VisitaDto, VisitasQueryDto } from './dto/agenda.dto.js';

interface Organizacion {
  nombre: string;
  tipo: string;
}

/** Todas las consultas SQL del módulo de agenda. Sin reglas de negocio. */
@Injectable()
export class AgendaRepositorio {
  async listarVisitas(db: Kysely<DB>, q: VisitasQueryDto) {
    const filtros = sql`
      (${q.municipioId ?? null}::int is null or municipio_id = ${q.municipioId ?? null})
      and (${q.estado ?? null}::text is null or estado = ${q.estado ?? null})
      and (${q.desde ?? null}::timestamptz is null or inicia_en >= ${q.desde ?? null}::timestamptz)
      and (${q.hasta ?? null}::timestamptz is null or inicia_en <= ${q.hasta ?? null}::timestamptz)
    `;
    const datos = await sql`
      select * from eventos.v_agenda where ${filtros} order by inicia_en desc limit ${q.porPagina} offset ${(q.pagina - 1) * q.porPagina}
    `.execute(db);
    const conteo = await sql<{ total: number }>`select count(*)::int as total from eventos.v_agenda where ${filtros}`.execute(db);
    return { datos: datos.rows, total: Number(conteo.rows[0].total) };
  }

  visitaPorId(db: Kysely<DB>, id: string) {
    return sql`select * from eventos.v_agenda where id = ${id}::uuid`
      .execute(db)
      .then((r) => r.rows[0]);
  }

  async lideresPresentes(db: Kysely<DB>, eventoId: string) {
    const { rows } = await sql`
      select p.nombres || ' ' || p.apellidos as nombre, m.cargo_codigo as cargo
        from eventos.lideres_presentes lp
        join campana.miembros m on m.id = lp.miembro_id
        join personas.personas p on p.id = m.persona_id
       where lp.evento_id = ${eventoId}::uuid
    `.execute(db);
    return rows;
  }

  async organizacionesPresentes(db: Kysely<DB>, eventoId: string) {
    const { rows } = await sql`
      select op.nombre, op.tipo_codigo as tipo from eventos.organizaciones_presentes op where op.evento_id = ${eventoId}::uuid
    `.execute(db);
    return rows;
  }

  async planteamientosDeEvento(db: Kysely<DB>, eventoId: string) {
    const { rows } = await sql`
      select n.id, n.descripcion, n.categoria_codigo, n.prioridad from participacion.necesidades n where n.evento_id = ${eventoId}::uuid
    `.execute(db);
    return rows;
  }

  async compromisosDeEvento(db: Kysely<DB>, eventoId: string) {
    const { rows } = await sql`select * from participacion.v_compromisos where evento_id = ${eventoId}::uuid`.execute(db);
    return rows;
  }

  eventoTerritorio(db: Kysely<DB>, id: string) {
    return sql<{ territorio_id: number }>`select territorio_id from eventos.eventos where id = ${id}::uuid`
      .execute(db)
      .then((r) => r.rows[0]);
  }

  eventoFechas(db: Kysely<DB>, id: string) {
    return sql<{ inicia_en: string; termina_en: string }>`select inicia_en, termina_en from eventos.eventos where id = ${id}::uuid`
      .execute(db)
      .then((r) => r.rows[0]);
  }

  async crearVisita(db: Kysely<DB>, id: string, u: { id: string }, dto: VisitaDto): Promise<void> {
    await sql`
      insert into eventos.eventos (id, tipo_codigo, nombre, territorio_id, lugar, inicia_en, termina_en, creado_por, estado, con_candidato, asistentes_aprox, resumen)
      values (
        ${id}::uuid, ${dto.tipo}, ${dto.nombre.trim()}, ${dto.territorioId},
        case when ${dto.lon ?? null}::float8 is null then null else ST_SetSRID(ST_MakePoint(${dto.lon ?? null}::float8, ${dto.lat ?? null}::float8), 4326) end,
        ${dto.iniciaEn}::timestamptz, ${dto.terminaEn}::timestamptz, ${u.id}::uuid, ${dto.estado},
        ${dto.conCandidato ?? true}, ${dto.asistentesAprox ?? null}, ${dto.resumen ?? null}
      )
    `.execute(db);
  }

  async actualizarVisita(
    db: Kysely<DB>,
    id: string,
    dto: { estado?: string; resumen?: string; asistentesAprox?: number; iniciaEn?: string; terminaEn?: string },
  ): Promise<void> {
    await sql`
      update eventos.eventos set
        estado = coalesce(${dto.estado ?? null}, estado),
        resumen = coalesce(${dto.resumen ?? null}, resumen),
        asistentes_aprox = coalesce(${dto.asistentesAprox ?? null}, asistentes_aprox),
        inicia_en = coalesce(${dto.iniciaEn ?? null}::timestamptz, inicia_en),
        termina_en = coalesce(${dto.terminaEn ?? null}::timestamptz, termina_en)
      where id = ${id}::uuid
    `.execute(db);
  }

  async reemplazarAcompanantes(db: Kysely<DB>, id: string, liderIds: string[], organizaciones: Organizacion[]): Promise<void> {
    await db.deleteFrom('eventos.lideres_presentes').where('evento_id', '=', id).execute();
    if (liderIds.length) {
      await db.insertInto('eventos.lideres_presentes').values(liderIds.map((miembro_id) => ({ evento_id: id, miembro_id }))).execute();
    }
    await db.deleteFrom('eventos.organizaciones_presentes').where('evento_id', '=', id).execute();
    if (organizaciones.length) {
      await db
        .insertInto('eventos.organizaciones_presentes')
        .values(organizaciones.map((o) => ({ evento_id: id, nombre: o.nombre.trim(), tipo_codigo: o.tipo })))
        .execute();
    }
  }

  async lideresActivosEntre(db: Kysely<DB>, ids: string[]): Promise<string[]> {
    if (!ids.length) return [];
    const { rows } = await sql<{ id: string }>`select id from campana.miembros where id = any(${sql.val(ids)}::uuid[]) and activo`.execute(db);
    return rows.map((r) => r.id);
  }

  async crearPlanteamiento(
    db: Kysely<DB>,
    id: string,
    datos: { territorioId: number; descripcion: string; categoria: string; eventoId: string; reportadoPor: string; prioridad: string },
  ): Promise<void> {
    await sql`
      insert into participacion.necesidades (id, territorio_id, descripcion, categoria_codigo, origen, evento_id, reportado_por, prioridad)
      values (${id}::uuid, ${datos.territorioId}, ${datos.descripcion}, ${datos.categoria}, 'VISITA', ${datos.eventoId}::uuid, ${datos.reportadoPor}::uuid, ${datos.prioridad})
    `.execute(db);
  }

  async crearReporte(
    db: Kysely<DB>,
    id: string,
    datos: { territorioId: number; descripcion: string; categoria: string | null; reportadoPor: string; prioridad: string },
  ): Promise<void> {
    await sql`
      insert into participacion.necesidades (id, territorio_id, descripcion, categoria_codigo, origen, reportado_por, prioridad)
      values (${id}::uuid, ${datos.territorioId}, ${datos.descripcion}, ${datos.categoria}, 'REPORTE_LIDER', ${datos.reportadoPor}::uuid, ${datos.prioridad})
    `.execute(db);
  }

  async misReportes(db: Kysely<DB>, usuarioId: string) {
    const { rows } = await sql`
      select id, territorio_id, descripcion, categoria_codigo, prioridad, reportada_en
        from participacion.necesidades
       where origen = 'REPORTE_LIDER' and reportado_por = ${usuarioId}::uuid
       order by reportada_en desc
    `.execute(db);
    return rows;
  }

  async compromisos(db: Kysely<DB>, q: CompromisosQueryDto) {
    const { rows } = await sql`
      select * from participacion.v_compromisos
       where (${q.municipioId ?? null}::int is null or municipio_id = ${q.municipioId ?? null})
         and (${q.estado ?? null}::text is null or estado = ${q.estado ?? null})
       order by creado_en desc
    `.execute(db);
    return rows;
  }

  async crearCompromiso(db: Kysely<DB>, id: string, usuarioId: string, dto: CompromisoDto): Promise<void> {
    await sql`
      insert into participacion.compromisos (id, evento_id, territorio_id, categoria_codigo, descripcion, responsable_miembro_id, creado_por)
      values (${id}::uuid, ${dto.eventoId ?? null}::uuid, ${dto.territorioId}, ${dto.categoria ?? null}, ${dto.descripcion.trim()}, ${dto.responsableMiembroId ?? null}::uuid, ${usuarioId}::uuid)
    `.execute(db);
    if (dto.necesidadIds?.length) {
      await db.insertInto('participacion.compromiso_necesidades').values(dto.necesidadIds.map((necesidad_id) => ({ compromiso_id: id, necesidad_id }))).execute();
    }
  }

  actualizarCompromiso(db: Kysely<DB>, id: string, estado: string, propuestaId: string | null) {
    return sql`
      update participacion.compromisos set estado = ${estado}, propuesta_id = ${propuestaId}::uuid
       where id = ${id}::uuid
      returning id, estado, propuesta_id
    `
      .execute(db)
      .then((r) => r.rows[0] as { id: string; estado: string; propuesta_id: string | null } | undefined);
  }

  departamentoId(db: Kysely<DB>) {
    return sql<{ id: number }>`select id from territorio.territorios where tipo_codigo = 'DEPARTAMENTO'`
      .execute(db)
      .then((r) => r.rows[0]?.id);
  }

  cobertura(db: Kysely<DB>, padreId: number) {
    return sql<{ geojson: unknown }>`
      select json_build_object('type','FeatureCollection','features',coalesce(json_agg(json_build_object(
               'type','Feature','id',v.territorio_id,
               'geometry',ST_AsGeoJSON(ST_SimplifyPreserveTopology(v.geom,0.0005),6)::json,
               'properties',json_build_object('nombre',v.nombre,'tipo',v.tipo_codigo,'visitas',v.visitas,'ultima_visita',v.ultima_visita)
             )), '[]'::json)) as geojson
        from eventos.v_cobertura v
       where v.padre_id = ${padreId} and v.geom is not null
    `
      .execute(db)
      .then((r) => r.rows[0].geojson);
  }

  async catalogos(db: Kysely<DB>) {
    const [eventos, organizaciones, categorias, propuestas] = await Promise.all([
      db.selectFrom('eventos.tipos_evento').selectAll().execute(),
      db.selectFrom('eventos.tipos_organizacion').selectAll().execute(),
      db.selectFrom('participacion.categorias_necesidad').selectAll().execute(),
      db.selectFrom('participacion.propuestas').select(['id', 'titulo']).where('publicada', '=', true).execute(),
    ]);
    return { eventos, organizaciones, categorias, propuestas };
  }
}
