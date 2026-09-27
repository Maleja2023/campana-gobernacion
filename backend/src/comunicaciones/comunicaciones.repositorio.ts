import { Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import type { DB } from '../database/db.types.js';

export interface Notificacion {
  id: string;
  tipo: string;
  titulo: string;
  cuerpo: string;
  enlace: string | null;
  creada_en: string;
  leida_en: string | null;
}

export interface Plantilla {
  id: string;
  nombre: string;
  canal_codigo: string;
  asunto: string | null;
  contenido: string;
  creada_por: string | null;
  autor: string | null;
  aprobada_en: string | null;
  aprobador: string | null;
}

/** Consultas de notificaciones internas, plantillas y envíos. */
@Injectable()
export class ComunicacionesRepositorio {
  async notificaciones(db: Kysely<DB>, limite: number) {
    const { rows } = await sql<Notificacion>`
      select id, tipo, titulo, cuerpo, enlace, creada_en, leida_en
        from comunicaciones.notificaciones
       order by creada_en desc
       limit ${limite}
    `.execute(db);
    const noLeidas = await sql<{ n: number }>`select count(*)::int as n from comunicaciones.notificaciones where leida_en is null`.execute(db);
    return { datos: rows, noLeidas: Number(noLeidas.rows[0].n) };
  }

  async marcarLeidas(db: Kysely<DB>, ids: string[] | null) {
    await sql`
      update comunicaciones.notificaciones set leida_en = now()
       where leida_en is null and (${ids === null}::boolean or id = any(${sql.val(ids ?? [])}::uuid[]))
    `.execute(db);
  }

  async avisoEquipo(db: Kysely<DB>, titulo: string, cuerpo: string, cargos: string[] | null) {
    const { rows } = await sql<{ n: number }>`
      select comunicaciones.enviar_aviso_equipo(${titulo}, ${cuerpo}, ${cargos === null ? null : sql.val(cargos)}::text[]) as n
    `.execute(db);
    return Number(rows[0].n);
  }

  async plantillas(db: Kysely<DB>) {
    const { rows } = await sql<Plantilla>`
      select p.id, p.nombre, p.canal_codigo, p.asunto, p.contenido, p.creada_por, ua.login as autor, p.aprobada_en, ub.login as aprobador
        from comunicaciones.plantillas p
        left join acceso.usuarios ua on ua.id = p.creada_por
        left join acceso.usuarios ub on ub.id = p.aprobada_por
       order by p.creada_en desc
    `.execute(db);
    return rows;
  }

  async crearPlantilla(db: Kysely<DB>, usuarioId: string, p: { nombre: string; canal: string; asunto: string | null; contenido: string }) {
    const { rows } = await sql<{ id: string }>`
      insert into comunicaciones.plantillas (nombre, canal_codigo, asunto, contenido, creada_por)
      values (${p.nombre}, ${p.canal}, ${p.asunto}, ${p.contenido}, ${usuarioId}::uuid)
      returning id
    `.execute(db);
    return rows[0].id;
  }

  async editarPlantilla(db: Kysely<DB>, id: string, asunto: string | null, contenido: string) {
    const r = await sql`
      update comunicaciones.plantillas set asunto = coalesce(${asunto}, asunto), contenido = ${contenido} where id = ${id}::uuid
    `.execute(db);
    return Number(r.numAffectedRows ?? 0);
  }

  async aprobarPlantilla(db: Kysely<DB>, id: string) {
    await sql`select comunicaciones.aprobar_plantilla(${id}::uuid)`.execute(db);
  }

  async envios(db: Kysely<DB>) {
    const { rows } = await sql`select * from comunicaciones.listado_envios()`.execute(db);
    return rows;
  }

  async prepararEnvio(db: Kysely<DB>, plantillaId: string, territorios: number[], programadoPara: string | null) {
    const { rows } = await sql<{ id: string }>`
      select comunicaciones.preparar_envio(${plantillaId}::uuid, ${sql.val(territorios)}::int[], ${programadoPara}::timestamptz) as id
    `.execute(db);
    return rows[0].id;
  }

  async cambiarEstadoEnvio(db: Kysely<DB>, id: string, estado: string) {
    await sql`select comunicaciones.cambiar_estado_envio(${id}::uuid, ${estado})`.execute(db);
  }

  // Proceso de envío (sin usuario) -------------------------------------------

  async enviosListos(db: Kysely<DB>) {
    const { rows } = await sql<{ id: string; canal: 'SMS' | 'EMAIL' | 'TELEGRAM'; contenido: string; asunto: string | null }>`
      select * from comunicaciones.tomar_envios_listos()
    `.execute(db);
    return rows;
  }

  async lote(db: Kysely<DB>, envioId: string, cantidad: number) {
    const { rows } = await sql<{ persona_id: string; nombre: string; telefono_cifrado: Buffer | null; correo: string | null }>`
      select * from comunicaciones.lote_destinatarios(${envioId}::uuid, ${cantidad}::int)
    `.execute(db);
    return rows;
  }

  async marcarDestinatario(db: Kysely<DB>, envioId: string, personaId: string, estado: 'ENVIADO' | 'FALLIDO', error: string | null) {
    await sql`select comunicaciones.marcar_destinatario(${envioId}::uuid, ${personaId}::uuid, ${estado}, ${error})`.execute(db);
  }

  async cerrarEnvio(db: Kysely<DB>, envioId: string, resultado: string | null = null) {
    const { rows } = await sql<{ cerrado: boolean }>`select comunicaciones.cerrar_envio(${envioId}::uuid, ${resultado}) as cerrado`.execute(db);
    return rows[0].cerrado;
  }

  async darDeBaja(db: Kysely<DB>, personaId: string, canal: string) {
    await sql`select comunicaciones.dar_de_baja(${personaId}::uuid, ${canal})`.execute(db);
  }
}
