import { Injectable, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { sql } from 'kysely';
import { DatabaseService } from '../database/database.service.js';
import type { TokenPayload, UsuarioSesion } from './auth.types.js';
import { hashearClave, verificarClave } from './claves.js';

const CREDENCIALES_INVALIDAS = 'Usuario o contraseña incorrectos';

@Injectable()
export class AuthService implements OnModuleInit {
  /** Hash de relleno: se verifica contra él cuando el usuario no existe, para
   *  que la respuesta tarde lo mismo y no revele qué usuarios existen. */
  private hashRelleno = '';

  constructor(
    private readonly database: DatabaseService,
    private readonly jwt: JwtService,
  ) {}

  async onModuleInit() {
    this.hashRelleno = await hashearClave('relleno-no-es-una-clave-real');
  }

  async iniciarSesion(login: string, clave: string, ip: string | null, userAgent: string | null) {
    const db = this.database.db;
    const usuario = await db
      .selectFrom('acceso.usuarios')
      .select(['id', 'login', 'password_hash', 'activo'])
      .where('login', '=', login.trim().toLowerCase())
      .executeTakeFirst();

    const claveCorrecta = await verificarClave(usuario?.password_hash ?? this.hashRelleno, clave);

    if (!usuario || !usuario.activo || !claveCorrecta) {
      if (usuario) {
        await sql`select auditoria.registrar_acceso(${usuario.id}::uuid, false, ${ip}::inet)`.execute(db);
      }
      throw new UnauthorizedException(CREDENCIALES_INVALIDAS);
    }

    const sesion = await db
      .insertInto('acceso.sesiones')
      .values({ usuario_id: usuario.id, ip, user_agent: userAgent?.slice(0, 300) ?? null })
      .returning('id')
      .executeTakeFirstOrThrow();

    await sql`select auditoria.registrar_acceso(${usuario.id}::uuid, true, ${ip}::inet)`.execute(db);

    const payload: TokenPayload = { sub: usuario.id, sid: sesion.id, login: usuario.login };
    return { token: await this.jwt.signAsync(payload) };
  }

  async cerrarSesion(usuario: UsuarioSesion) {
    await this.database.db
      .updateTable('acceso.sesiones')
      .set({ cerrada_en: new Date() })
      .where('id', '=', usuario.sesionId)
      .where('cerrada_en', 'is', null)
      .execute();
  }

  /** Datos del usuario para el frontend: nombre, roles, permisos y territorios. */
  async perfil(usuario: UsuarioSesion) {
    return this.database.comoUsuario(usuario.id, async (trx) => {
      const datos = await trx
        .selectFrom('acceso.usuarios as u')
        .innerJoin('personas.personas as p', 'p.id', 'u.persona_id')
        .select(['u.id', 'u.login', 'p.nombres', 'p.apellidos'])
        .where('u.id', '=', usuario.id)
        .executeTakeFirstOrThrow();

      const roles = await trx
        .selectFrom('acceso.usuario_roles')
        .select('rol_codigo')
        .where('usuario_id', '=', usuario.id)
        .execute();

      const { rows: permisos } = await sql<{ permiso_codigo: string }>`
        select permiso_codigo from acceso.permisos_de(${usuario.id}::uuid) order by 1
      `.execute(trx);

      const territorios = await trx
        .selectFrom('acceso.usuario_territorios as ut')
        .innerJoin('territorio.territorios as t', 't.id', 'ut.territorio_id')
        .select(['t.id', 't.tipo_codigo', 't.nombre'])
        .where('ut.usuario_id', '=', usuario.id)
        .execute();

      return {
        ...datos,
        roles: roles.map((r) => r.rol_codigo),
        permisos: permisos.map((p) => p.permiso_codigo),
        territorios,
      };
    });
  }
}
