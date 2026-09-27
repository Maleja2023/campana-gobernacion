import { Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import type { DB } from '../database/db.types.js';

/** Derechos del titular (Ley 1581) y bitácora de auditoría. */
@Injectable()
export class TitularRepositorio {
  async radicar(db: Kysely<DB>, d: { tipo: string; documentoHash: Buffer; contacto: string; descripcion: string }) {
    const { rows } = await sql<{ radicado: string; fecha_limite: string }>`
      select radicado, fecha_limite from cumplimiento.radicar_solicitud(${d.tipo}, ${d.documentoHash}, ${d.contacto}, ${d.descripcion})
    `.execute(db);
    return rows[0];
  }

  async estado(db: Kysely<DB>, radicado: string, documentoHash: Buffer) {
    const { rows } = await sql`select * from cumplimiento.estado_solicitud(${radicado}, ${documentoHash})`.execute(db);
    return rows[0];
  }

  async bajaPorDocumento(db: Kysely<DB>, documentoHash: Buffer, canal: string | null) {
    await sql`select comunicaciones.dar_de_baja_por_documento(${documentoHash}, ${canal})`.execute(db);
  }

  async listado(db: Kysely<DB>, estado: string | undefined) {
    const { rows } = await sql`select * from cumplimiento.listado_solicitudes(${estado ?? null})`.execute(db);
    return rows;
  }

  async datos(db: Kysely<DB>, id: string) {
    const { rows } = await sql<{ datos: Record<string, unknown> | null }>`select cumplimiento.datos_del_titular(${id}::uuid) as datos`.execute(db);
    return rows[0]?.datos ?? null;
  }

  async tramitar(db: Kysely<DB>, id: string, accion: string, respuesta: string | null) {
    await sql`select cumplimiento.tramitar_solicitud(${id}::uuid, ${accion}, ${respuesta})`.execute(db);
  }

  async bitacora(db: Kysely<DB>, f: { usuario?: string; accion?: string; tabla?: string; desde?: string; hasta?: string }, limite: number, desplazamiento: number) {
    const { rows } = await sql<Record<string, unknown> & { total: string }>`
      select * from auditoria.bitacora(${f.usuario ?? null}, ${f.accion ?? null}, ${f.tabla ?? null},
                                       ${f.desde ?? null}::date, ${f.hasta ?? null}::date, ${limite}, ${desplazamiento})
    `.execute(db);
    return rows;
  }
}
