import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { sql } from 'kysely';
import { DatabaseService } from '../database/database.service.js';

@Controller('salud')
export class SaludController {
  constructor(private readonly database: DatabaseService) {}

  /** Verifica que la API y la base de datos respondan. */
  @Get()
  async revisar() {
    try {
      const { rows } = await sql<{ usuario: string; postgis: string }>`
        select current_user as usuario, postgis_lib_version() as postgis
      `.execute(this.database.db);
      return { api: 'ok', baseDatos: 'ok', usuarioBaseDatos: rows[0].usuario, postgis: rows[0].postgis };
    } catch {
      throw new ServiceUnavailableException({ api: 'ok', baseDatos: 'sin conexión' });
    }
  }
}
