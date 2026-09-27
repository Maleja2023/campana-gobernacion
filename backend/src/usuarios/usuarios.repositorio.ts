import { Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import type { DB } from '../database/db.types.js';

export interface FiltrosListado {
  texto?: string;
  activo?: boolean;
  limite: number;
  offset: number;
}

/** Todas las consultas SQL del módulo de usuarios. Sin reglas de negocio. */
@Injectable()
export class UsuariosRepositorio {
  async listar(db: Kysely<DB>, filtros: FiltrosListado) {
    const patron = filtros.texto ? `%${filtros.texto.trim()}%` : null;
    const condiciones = sql`
      (${patron}::text is null or u.login ilike ${patron} or p.nombres ilike ${patron} or p.apellidos ilike ${patron})
      and (${filtros.activo ?? null}::boolean is null or u.activo = ${filtros.activo ?? null}::boolean)
    `;
    const datos = await sql`
      select u.id, u.login, p.nombres, p.apellidos, u.activo,
             u.debe_cambiar_clave,
             coalesce((select json_agg(json_build_object('codigo', r.codigo, 'nombre', r.nombre) order by r.codigo)
                         from acceso.usuario_roles ur join acceso.roles r on r.codigo = ur.rol_codigo
                        where ur.usuario_id = u.id), '[]'::json) as roles,
             coalesce((select json_agg(json_build_object('id', t.id, 'nombre', t.nombre) order by t.nombre)
                         from acceso.usuario_territorios ut join territorio.territorios t on t.id = ut.territorio_id
                        where ut.usuario_id = u.id), '[]'::json) as territorios,
             (select c.codigo from campana.miembros m join campana.cargos c on c.codigo = m.cargo_codigo where m.persona_id = u.persona_id) as cargo,
             (select max(s.iniciada_en) from acceso.sesiones s where s.usuario_id = u.id) as ultimo_ingreso
        from acceso.usuarios u
        join personas.personas p on p.id = u.persona_id
       where ${condiciones}
       order by p.apellidos, p.nombres, u.login
       limit ${filtros.limite} offset ${filtros.offset}
    `.execute(db);
    const { rows: totalRows } = await sql<{ total: number }>`
      select count(*)::integer as total
        from acceso.usuarios u join personas.personas p on p.id = u.persona_id
       where ${condiciones}
    `.execute(db);
    return { datos: datos.rows, total: Number(totalRows[0].total) };
  }

  async rolesAsignables(db: Kysely<DB>) {
    const { rows } = await sql`
      select r.codigo, r.nombre, r.descripcion
        from acceso.roles r
       where r.codigo in (select rol_codigo from acceso.roles_que_puedo_asignar())
       order by r.nombre
    `.execute(db);
    return rows;
  }

  async departamentoId(db: Kysely<DB>): Promise<number | undefined> {
    const fila = await db
      .selectFrom('territorio.territorios')
      .select('id')
      .where('tipo_codigo', '=', 'DEPARTAMENTO')
      .executeTakeFirst();
    return fila?.id;
  }

  async rolesPermitidos(db: Kysely<DB>): Promise<string[]> {
    const { rows } = await sql<{ rol_codigo: string }>`select rol_codigo from acceso.roles_que_puedo_asignar()`.execute(db);
    return rows.map((r) => r.rol_codigo);
  }

  async territoriosVisiblesEntre(db: Kysely<DB>, ids: number[]): Promise<number[]> {
    if (!ids.length) return [];
    const { rows } = await sql<{ territorio_id: number }>`
      select territorio_id from acceso.territorios_visibles() where territorio_id = any(${sql.val(ids)}::integer[])
    `.execute(db);
    return rows.map((r) => r.territorio_id);
  }

  async esMunicipio(db: Kysely<DB>, territorioId: number): Promise<boolean> {
    const fila = await db
      .selectFrom('territorio.territorios')
      .select('id')
      .where('id', '=', territorioId)
      .where('tipo_codigo', '=', 'MUNICIPIO')
      .executeTakeFirst();
    return Boolean(fila);
  }

  async municipioDeMiembro(db: Kysely<DB>, miembroId: string): Promise<{ tieneTerritorio: boolean; municipioId: number | null }> {
    const { rows } = await sql<{ tiene: boolean; municipio_id: number | null }>`
      select exists (select 1 from campana.miembro_territorios where miembro_id = ${miembroId}::uuid) as tiene,
             campana.municipio_id_de_miembro(${miembroId}::uuid) as municipio_id
    `.execute(db);
    return { tieneTerritorio: rows[0].tiene, municipioId: rows[0].municipio_id };
  }

  async asignarTerritorioMiembro(db: Kysely<DB>, miembroId: string, territorioId: number): Promise<void> {
    await db.insertInto('campana.miembro_territorios').values({ miembro_id: miembroId, territorio_id: territorioId }).execute();
  }

  personaDeMiembroEnRed(db: Kysely<DB>, miembroId: string) {
    return sql<{ persona_id: string }>`
      select m.persona_id from campana.miembros m where m.id = ${miembroId}::uuid and m.id in (select miembro_id from campana.mi_red())
    `
      .execute(db)
      .then((r) => r.rows[0]);
  }

  personaPorDocumento(db: Kysely<DB>, hash: Buffer) {
    return db
      .selectFrom('personas.personas')
      .select('id')
      .where('tipo_documento_codigo', '=', 'CC')
      .where('documento_hash', '=', hash)
      .executeTakeFirst();
  }

  async crearPersona(db: Kysely<DB>, datos: { id: string; documentoHash: Buffer; documentoCifrado: Buffer; nombres: string; apellidos: string }) {
    await db
      .insertInto('personas.personas')
      .values({
        id: datos.id,
        tipo_documento_codigo: 'CC',
        documento_hash: datos.documentoHash,
        documento_cifrado: datos.documentoCifrado,
        nombres: datos.nombres,
        apellidos: datos.apellidos,
      })
      .execute();
  }

  usuarioPorPersona(db: Kysely<DB>, personaId: string) {
    return db.selectFrom('acceso.usuarios').select('id').where('persona_id', '=', personaId).executeTakeFirst();
  }

  usuarioPorId(db: Kysely<DB>, usuarioId: string) {
    return db.selectFrom('acceso.usuarios').select(['id', 'activo']).where('id', '=', usuarioId).executeTakeFirst();
  }

  rolesDeUsuario(db: Kysely<DB>, usuarioId: string) {
    return db.selectFrom('acceso.usuario_roles').select('rol_codigo').where('usuario_id', '=', usuarioId).execute();
  }

  territoriosDeUsuario(db: Kysely<DB>, usuarioId: string) {
    return db.selectFrom('acceso.usuario_territorios').select('territorio_id').where('usuario_id', '=', usuarioId).execute();
  }

  crearUsuario(db: Kysely<DB>, datos: { id: string; login: string; passwordHash: string; personaId: string }) {
    return db
      .insertInto('acceso.usuarios')
      .values({ id: datos.id, login: datos.login, password_hash: datos.passwordHash, persona_id: datos.personaId, debe_cambiar_clave: true })
      .returning('id')
      .executeTakeFirstOrThrow();
  }

  async reemplazarRolesYTerritorios(db: Kysely<DB>, usuarioId: string, roles: string[], territorios: number[]): Promise<void> {
    await db.deleteFrom('acceso.usuario_roles').where('usuario_id', '=', usuarioId).execute();
    await db.insertInto('acceso.usuario_roles').values(roles.map((rol_codigo) => ({ usuario_id: usuarioId, rol_codigo }))).execute();
    await db.deleteFrom('acceso.usuario_territorios').where('usuario_id', '=', usuarioId).execute();
    if (territorios.length) {
      await db.insertInto('acceso.usuario_territorios').values(territorios.map((territorio_id) => ({ usuario_id: usuarioId, territorio_id }))).execute();
    }
  }

  async actualizarActivo(db: Kysely<DB>, usuarioId: string, activo: boolean): Promise<void> {
    await db.updateTable('acceso.usuarios').set({ activo }).where('id', '=', usuarioId).execute();
  }

  async cerrarSesionesDe(db: Kysely<DB>, usuarioId: string): Promise<void> {
    await db.updateTable('acceso.sesiones').set({ cerrada_en: new Date() }).where('usuario_id', '=', usuarioId).where('cerrada_en', 'is', null).execute();
  }

  async actualizarClave(db: Kysely<DB>, usuarioId: string, passwordHash: string): Promise<void> {
    await db.updateTable('acceso.usuarios').set({ password_hash: passwordHash, debe_cambiar_clave: true }).where('id', '=', usuarioId).execute();
  }
}
