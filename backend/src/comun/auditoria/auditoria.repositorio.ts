import { Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import type { DB } from '../../database/db.types.js';

export type AccionSeguridad =
  | 'MFA_ACTIVADO'
  | 'MFA_FALLIDO'
  | 'MFA_RESTABLECIDO'
  | 'CODIGO_RECUPERACION_USADO'
  | 'RENOVACION_REUTILIZADA';

/** Bitácora de eventos de seguridad (auditoria.registrar_seguridad). Sin reglas de negocio. */
@Injectable()
export class AuditoriaRepositorio {
  async registrarSeguridad(db: Kysely<DB>, usuarioId: string, accion: AccionSeguridad, ip: string | null): Promise<void> {
    await sql`select auditoria.registrar_seguridad(${usuarioId}::uuid, ${accion}, ${ip}::inet)`.execute(db);
  }
}
