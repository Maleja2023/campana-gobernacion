import { Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import type { DB } from '../database/db.types.js';

export interface UsuarioLogin {
  id: string;
  login: string;
  password_hash: string;
  activo: boolean;
}

export interface ParametrosBloqueo {
  intentos: number;
  minutos: number;
}

export interface EstadoSesionFila {
  debe_cambiar_clave: boolean;
  mfa_verificado: boolean;
  requiere_mfa: boolean;
  tiene_factor: boolean;
}

export interface SesionRenovacion {
  id: string;
  usuario_id: string;
}

export interface SesionRenovacionVigente extends SesionRenovacion {
  login: string;
}

/** Todas las consultas SQL del módulo de autenticación. Sin reglas de negocio. */
@Injectable()
export class AuthRepositorio {
  buscarPorLogin(db: Kysely<DB>, login: string): Promise<UsuarioLogin | undefined> {
    return db
      .selectFrom('acceso.usuarios')
      .select(['id', 'login', 'password_hash', 'activo'])
      .where('login', '=', login)
      .executeTakeFirst();
  }

  async obtenerParametrosBloqueo(db: Kysely<DB>): Promise<ParametrosBloqueo> {
    const filas = await db
      .selectFrom('campana.parametros')
      .select(['clave', 'valor'])
      .where('clave', 'in', ['BLOQUEO_INTENTOS', 'BLOQUEO_MINUTOS'])
      .execute();
    const valores = Object.fromEntries(filas.map((f) => [f.clave, Number(f.valor)]));
    return { intentos: valores.BLOQUEO_INTENTOS ?? 5, minutos: valores.BLOQUEO_MINUTOS ?? 15 };
  }

  async intentosFallidosRecientes(db: Kysely<DB>, usuarioId: string, minutos: number): Promise<number> {
    const { rows } = await sql<{ total: number }>`
      select acceso.intentos_fallidos_recientes(${usuarioId}::uuid, ${minutos}) as total
    `.execute(db);
    return rows[0].total;
  }

  async registrarAcceso(db: Kysely<DB>, usuarioId: string, exito: boolean, ip: string | null): Promise<void> {
    await sql`select auditoria.registrar_acceso(${usuarioId}::uuid, ${exito}, ${ip}::inet)`.execute(db);
  }

  /** Crea la sesión ya con el hash del token de renovación inicial. */
  crearSesion(
    db: Kysely<DB>,
    datos: { usuarioId: string; ip: string | null; userAgent: string | null; renovacionHash: Buffer; renovacionExpiraEn: Date },
  ) {
    return db
      .insertInto('acceso.sesiones')
      .values({
        usuario_id: datos.usuarioId,
        ip: datos.ip,
        user_agent: datos.userAgent,
        renovacion_hash: datos.renovacionHash,
        renovacion_expira_en: datos.renovacionExpiraEn,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
  }

  buscarSesionActiva(db: Kysely<DB>, sesionId: string, usuarioId: string) {
    return db
      .selectFrom('acceso.sesiones as s')
      .select('s.id')
      .where('s.id', '=', sesionId)
      .where('s.usuario_id', '=', usuarioId)
      .where('s.cerrada_en', 'is', null)
      .executeTakeFirst();
  }

  /** Todo lo que hace falta para calcular `EstadoSesion`, en una sola consulta. */
  estadoDeSesion(db: Kysely<DB>, sesionId: string, usuarioId: string): Promise<EstadoSesionFila | undefined> {
    return sql<EstadoSesionFila>`
      select u.debe_cambiar_clave, s.mfa_verificado,
             acceso.usuario_requiere_mfa(u.id) as requiere_mfa,
             exists(
               select 1 from acceso.factores_mfa f where f.usuario_id = u.id and f.confirmado_en is not null
             ) as tiene_factor
        from acceso.sesiones s
        join acceso.usuarios u on u.id = s.usuario_id
       where s.id = ${sesionId}::uuid and s.usuario_id = ${usuarioId}::uuid
         and s.cerrada_en is null and u.activo = true
    `
      .execute(db)
      .then((r) => r.rows[0]);
  }

  async cerrarSesion(db: Kysely<DB>, sesionId: string): Promise<void> {
    await db
      .updateTable('acceso.sesiones')
      .set({ cerrada_en: new Date() })
      .where('id', '=', sesionId)
      .where('cerrada_en', 'is', null)
      .execute();
  }

  async cerrarOtrasSesiones(db: Kysely<DB>, usuarioId: string, sesionActualId: string): Promise<void> {
    await db
      .updateTable('acceso.sesiones')
      .set({ cerrada_en: new Date() })
      .where('usuario_id', '=', usuarioId)
      .where('id', '!=', sesionActualId)
      .where('cerrada_en', 'is', null)
      .execute();
  }

  async marcarMfaVerificado(db: Kysely<DB>, sesionId: string): Promise<void> {
    await db.updateTable('acceso.sesiones').set({ mfa_verificado: true }).where('id', '=', sesionId).execute();
  }

  /** Sesión cuyo token de renovación VIGENTE (no rotado) es este hash. */
  sesionPorRenovacionVigente(db: Kysely<DB>, hash: Buffer): Promise<SesionRenovacionVigente | undefined> {
    return db
      .selectFrom('acceso.sesiones as s')
      .innerJoin('acceso.usuarios as u', 'u.id', 's.usuario_id')
      .select(['s.id', 's.usuario_id', 'u.login'])
      .where('s.renovacion_hash', '=', hash)
      .where('s.cerrada_en', 'is', null)
      .where('s.renovacion_expira_en', '>', new Date())
      .executeTakeFirst();
  }

  /** Sesión cuyo token de renovación ya fue ROTADO (presentarlo de nuevo = posible robo). */
  sesionPorRenovacionAnterior(db: Kysely<DB>, hash: Buffer): Promise<SesionRenovacion | undefined> {
    return db
      .selectFrom('acceso.sesiones')
      .select(['id', 'usuario_id'])
      .where('renovacion_anterior_hash', '=', hash)
      .executeTakeFirst();
  }

  async rotarRenovacion(
    db: Kysely<DB>,
    sesionId: string,
    datos: { hashAnterior: Buffer; hashNuevo: Buffer; expiraEn: Date },
  ): Promise<void> {
    await db
      .updateTable('acceso.sesiones')
      .set({
        renovacion_anterior_hash: datos.hashAnterior,
        renovacion_hash: datos.hashNuevo,
        renovacion_expira_en: datos.expiraEn,
        ultimo_uso_en: new Date(),
      })
      .where('id', '=', sesionId)
      .execute();
  }

  perfilBasico(db: Kysely<DB>, usuarioId: string) {
    return db
      .selectFrom('acceso.usuarios as u')
      .innerJoin('personas.personas as p', 'p.id', 'u.persona_id')
      .select(['u.id', 'u.login', 'u.debe_cambiar_clave', 'p.nombres', 'p.apellidos'])
      .where('u.id', '=', usuarioId)
      .executeTakeFirst();
  }

  rolesDe(db: Kysely<DB>, usuarioId: string) {
    return db.selectFrom('acceso.usuario_roles').select('rol_codigo').where('usuario_id', '=', usuarioId).execute();
  }

  async permisosDe(db: Kysely<DB>, usuarioId: string): Promise<string[]> {
    const { rows } = await sql<{ permiso_codigo: string }>`
      select permiso_codigo from acceso.permisos_de(${usuarioId}::uuid) order by 1
    `.execute(db);
    return rows.map((r) => r.permiso_codigo);
  }

  territoriosDe(db: Kysely<DB>, usuarioId: string) {
    return db
      .selectFrom('acceso.usuario_territorios as ut')
      .innerJoin('territorio.territorios as t', 't.id', 'ut.territorio_id')
      .select(['t.id', 't.tipo_codigo', 't.nombre'])
      .where('ut.usuario_id', '=', usuarioId)
      .execute();
  }

  obtenerHashClave(db: Kysely<DB>, usuarioId: string) {
    return db.selectFrom('acceso.usuarios').select('password_hash').where('id', '=', usuarioId).executeTakeFirst();
  }

  async actualizarClave(db: Kysely<DB>, usuarioId: string, hash: string): Promise<void> {
    await db
      .updateTable('acceso.usuarios')
      .set({ password_hash: hash, debe_cambiar_clave: false })
      .where('id', '=', usuarioId)
      .execute();
  }
}
