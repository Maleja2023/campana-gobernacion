import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { sql } from 'kysely';
import { DatabaseService } from '../database/database.service.js';

/**
 * Tareas de mantenimiento periódico (README, sección "Tareas programadas").
 * Las dos funciones SQL son SECURITY DEFINER y no dependen de un usuario de
 * sesión: se llaman directamente sobre database.db, sin comoUsuario().
 */
@Injectable()
export class MantenimientoService {
  private readonly logger = new Logger(MantenimientoService.name);

  constructor(private readonly database: DatabaseService) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async refrescarConteos(): Promise<void> {
    try {
      await sql`select campana.refrescar_conteos()`.execute(this.database.db);
    } catch (error) {
      this.logger.error('No se pudieron refrescar los conteos del mapa', error instanceof Error ? error.stack : error);
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async purgarMensajes(): Promise<void> {
    try {
      const { rows } = await sql<{ purgar_mensajes: number }>`select chatbot.purgar_mensajes()`.execute(this.database.db);
      this.logger.log(`Mensajes del chatbot purgados: ${rows[0]?.purgar_mensajes ?? 0}`);
    } catch (error) {
      this.logger.error('No se pudo purgar los mensajes del chatbot', error instanceof Error ? error.stack : error);
    }
  }
}
