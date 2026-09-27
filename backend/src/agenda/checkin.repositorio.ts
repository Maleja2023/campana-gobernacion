import { Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import type { DB } from '../database/db.types.js';

export interface DatosCheckin {
  codigo: string;
  documentoHash: Buffer;
  documentoCifrado: Buffer;
  nombres: string;
  apellidos: string;
  telefonoHash: Buffer | null;
  telefonoCifrado: Buffer | null;
  territorioId: number;
  politicaVersion: number;
  finalidades: string[];
  ip: string | null;
  userAgent: string | null;
}

/** Consultas del check-in de eventos y del comparativo de asistencia. */
@Injectable()
export class CheckinRepositorio {
  infoPublica(db: Kysely<DB>, codigo: string) {
    return sql<{
      nombre: string;
      tipo: string;
      lugar: string;
      municipio_id: number;
      inicia_en: string;
      termina_en: string;
      estado: string;
      abierto: boolean;
      abre_en: string;
      cierra_en: string;
    }>`select * from eventos.info_checkin(${codigo})`
      .execute(db)
      .then((r) => r.rows[0]);
  }

  async checkinPublico(db: Kysely<DB>, d: DatosCheckin): Promise<string> {
    const { rows } = await sql<{ resultado: string }>`
      select eventos.checkin_publico(
        ${d.codigo}, 'CC', ${d.documentoHash}, ${d.documentoCifrado}, ${d.nombres}, ${d.apellidos},
        ${d.telefonoHash}, ${d.telefonoCifrado}, ${d.territorioId}::int, ${d.politicaVersion}::smallint,
        ${sql.val(d.finalidades)}::text[], ${d.ip}::inet, ${d.userAgent}
      ) as resultado
    `.execute(db);
    return rows[0].resultado;
  }

  codigoEvento(db: Kysely<DB>, eventoId: string) {
    return sql<{ codigo_checkin: string; estado: string }>`select codigo_checkin, estado from eventos.eventos where id = ${eventoId}::uuid`
      .execute(db)
      .then((r) => r.rows[0]);
  }

  async asistentes(db: Kysely<DB>, eventoId: string) {
    const { rows } = await sql<{
      persona_id: string;
      nombre: string;
      residencia: string | null;
      metodo: string;
      registrada_en: string;
      nuevo: boolean;
    }>`select * from eventos.asistentes_evento(${eventoId}::uuid)`.execute(db);
    return rows;
  }

  marcarAsistencia(db: Kysely<DB>, eventoId: string, documentoHash: Buffer) {
    return sql<{ resultado: string; nombre: string | null }>`select * from eventos.marcar_asistencia(${eventoId}::uuid, 'CC', ${documentoHash})`
      .execute(db)
      .then((r) => r.rows[0]);
  }

  async comparativo(db: Kysely<DB>, desde: string, hasta: string, municipioId: number | null) {
    const { rows } = await sql<{
      zona_id: number;
      zona: string;
      eventos: number;
      asistentes: number;
      asistentes_nuevos: number;
      referidos: number;
      referidos_en_eventos: number;
    }>`select * from eventos.comparativo_zonas(${desde}::date, ${hasta}::date, ${municipioId}::int)`.execute(db);
    return rows.map((r) => ({
      ...r,
      eventos: Number(r.eventos),
      asistentes: Number(r.asistentes),
      asistentes_nuevos: Number(r.asistentes_nuevos),
      referidos: Number(r.referidos),
      referidos_en_eventos: Number(r.referidos_en_eventos),
    }));
  }
}
