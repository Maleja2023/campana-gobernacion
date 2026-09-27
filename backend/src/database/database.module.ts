import { Global, Inject, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import { KYSELY } from './database.constants.js';
import { DatabaseService } from './database.service.js';
import type { DB } from './db.types.js';

// Conteos (bigint) y porcentajes (numeric) llegan como número, no como texto.
// Coincide con los tipos generados (npm run db:tipos).
pg.types.setTypeParser(pg.types.builtins.INT8, (valor) => Number.parseInt(valor, 10));
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (valor) => Number.parseFloat(valor));
pg.types.setTypeParser(pg.types.builtins.DATE, (valor) => valor);

@Global()
@Module({
  providers: [
    {
      provide: KYSELY,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Kysely<DB> => {
        const usuario = config.getOrThrow<string>('DB_USUARIO');
        if (usuario === 'postgres') {
          // El dueño de las tablas se salta la seguridad por fila.
          throw new Error('La API no puede conectarse como "postgres". Use api_campana.');
        }
        const pool = new pg.Pool({
          host: config.getOrThrow<string>('DB_HOST'),
          port: Number(config.get<string>('DB_PORT') ?? 5432),
          database: config.getOrThrow<string>('DB_NOMBRE'),
          user: usuario,
          password: config.getOrThrow<string>('DB_CLAVE'),
          max: 10,
        });
        // Si PostgreSQL cierra una conexión (reinicio de la base, o
        // idle_in_transaction_session_timeout cuando el proceso de la API se
        // pausa, p. ej. al hacer clic en su ventana de comandos en Windows),
        // pg emite 'error'. Sin quien lo escuche, ese evento tumba toda la API;
        // así solo falla la petición en curso y el pool abre otra conexión.
        const log = new Logger('BaseDeDatos');
        const avisar = (error: Error) => log.warn(`Conexión con PostgreSQL cerrada: ${error.message}`);
        pool.on('error', avisar);
        pool.on('connect', (cliente) => cliente.on('error', avisar));
        return new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
      },
    },
    DatabaseService,
  ],
  exports: [KYSELY, DatabaseService],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(KYSELY) private readonly db: Kysely<DB>) {}

  async onApplicationShutdown(): Promise<void> {
    await this.db.destroy();
  }
}
