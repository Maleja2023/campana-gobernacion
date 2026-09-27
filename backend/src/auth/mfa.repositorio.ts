import { Injectable } from '@nestjs/common';
import { Kysely } from 'kysely';
import type { DB } from '../database/db.types.js';

export interface FactorMfa {
  id: string;
  secreto_cifrado: Buffer;
  confirmado_en: Date | null;
  ultimo_paso: number | null;
}

export interface CodigoRecuperacion {
  id: string;
  codigo_hash: string;
}

/** Todas las consultas SQL del doble factor. Sin reglas de negocio. */
@Injectable()
export class MfaRepositorio {
  factorSinConfirmar(db: Kysely<DB>, usuarioId: string): Promise<FactorMfa | undefined> {
    return db
      .selectFrom('acceso.factores_mfa')
      .select(['id', 'secreto_cifrado', 'confirmado_en', 'ultimo_paso'])
      .where('usuario_id', '=', usuarioId)
      .where('confirmado_en', 'is', null)
      .executeTakeFirst();
  }

  factorConfirmado(db: Kysely<DB>, usuarioId: string): Promise<FactorMfa | undefined> {
    return db
      .selectFrom('acceso.factores_mfa')
      .select(['id', 'secreto_cifrado', 'confirmado_en', 'ultimo_paso'])
      .where('usuario_id', '=', usuarioId)
      .where('confirmado_en', 'is not', null)
      .executeTakeFirst();
  }

  async borrarFactoresSinConfirmar(db: Kysely<DB>, usuarioId: string): Promise<void> {
    await db.deleteFrom('acceso.factores_mfa').where('usuario_id', '=', usuarioId).where('confirmado_en', 'is', null).execute();
  }

  async borrarTodosLosFactores(db: Kysely<DB>, usuarioId: string): Promise<void> {
    await db.deleteFrom('acceso.factores_mfa').where('usuario_id', '=', usuarioId).execute();
  }

  crearFactor(db: Kysely<DB>, usuarioId: string, secretoCifrado: Buffer) {
    return db
      .insertInto('acceso.factores_mfa')
      .values({ usuario_id: usuarioId, tipo: 'TOTP', secreto_cifrado: secretoCifrado })
      .returning('id')
      .executeTakeFirstOrThrow();
  }

  async confirmarFactor(db: Kysely<DB>, factorId: string, paso: number): Promise<void> {
    await db
      .updateTable('acceso.factores_mfa')
      .set({ confirmado_en: new Date(), ultimo_paso: paso })
      .where('id', '=', factorId)
      .execute();
  }

  async actualizarUltimoPaso(db: Kysely<DB>, factorId: string, paso: number): Promise<void> {
    await db.updateTable('acceso.factores_mfa').set({ ultimo_paso: paso }).where('id', '=', factorId).execute();
  }

  async borrarCodigosRecuperacion(db: Kysely<DB>, usuarioId: string): Promise<void> {
    await db.deleteFrom('acceso.codigos_recuperacion').where('usuario_id', '=', usuarioId).execute();
  }

  async crearCodigosRecuperacion(db: Kysely<DB>, usuarioId: string, hashes: string[]): Promise<void> {
    await db
      .insertInto('acceso.codigos_recuperacion')
      .values(hashes.map((codigo_hash) => ({ usuario_id: usuarioId, codigo_hash })))
      .execute();
  }

  codigosNoUsados(db: Kysely<DB>, usuarioId: string): Promise<CodigoRecuperacion[]> {
    return db
      .selectFrom('acceso.codigos_recuperacion')
      .select(['id', 'codigo_hash'])
      .where('usuario_id', '=', usuarioId)
      .where('usado_en', 'is', null)
      .execute();
  }

  async marcarCodigoUsado(db: Kysely<DB>, id: string): Promise<void> {
    await db.updateTable('acceso.codigos_recuperacion').set({ usado_en: new Date() }).where('id', '=', id).execute();
  }
}
