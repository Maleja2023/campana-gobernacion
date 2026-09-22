import { Inject, Injectable } from '@nestjs/common';
import { Kysely, sql, Transaction } from 'kysely';
import { KYSELY } from './database.constants.js';
import type { DB } from './db.types.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class DatabaseService {
  constructor(@Inject(KYSELY) readonly db: Kysely<DB>) {}

  /**
   * Ejecuta `fn` en una transacción identificando al usuario de la app.
   *
   * La base usa `app.usuario_id` para aplicar la seguridad por fila (RLS):
   * cada usuario ve solo su territorio o su red. `SET LOCAL` (set_config con
   * `true`) dura solo esta transacción, así que nunca se mezcla con la
   * petición de otro usuario que use la misma conexión del pool.
   *
   * Sin usuario (null) las tablas protegidas se ven vacías: sirve para
   * operaciones públicas como el registro desde el chatbot.
   */
  async comoUsuario<T>(
    usuarioId: string | null,
    fn: (trx: Transaction<DB>) => Promise<T>,
  ): Promise<T> {
    if (usuarioId !== null && !UUID.test(usuarioId)) {
      throw new Error('Identificador de usuario inválido');
    }
    return this.db.transaction().execute(async (trx) => {
      if (usuarioId !== null) {
        await sql`select set_config('app.usuario_id', ${usuarioId}, true)`.execute(trx);
      }
      return fn(trx);
    });
  }
}
