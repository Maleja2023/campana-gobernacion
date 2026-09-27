import { Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import type { DB } from '../database/db.types.js';

export interface NuevoMiembro {
  personaId: string;
  cargo: string;
  superiorId: string;
}

export interface NuevaPersona {
  id: string;
  documentoHash: Buffer;
  documentoCifrado: Buffer;
  nombres: string;
  apellidos: string;
}

/** Todas las consultas SQL del módulo de red. Sin reglas de negocio. */
@Injectable()
export class RedRepositorio {
  miembroDelUsuario(db: Kysely<DB>, usuarioId: string) {
    return db
      .selectFrom('acceso.usuarios as u')
      .innerJoin('campana.miembros as m', 'm.persona_id', 'u.persona_id')
      .select('m.id')
      .where('u.id', '=', usuarioId)
      .executeTakeFirst();
  }

  async miembroEnRed(db: Kysely<DB>, miembroId: string): Promise<boolean> {
    const { rows } = await sql<{ miembro_id: string }>`
      select miembro_id from campana.miembros_visibles() where miembro_id = ${miembroId}::uuid
    `.execute(db);
    return Boolean(rows[0]);
  }

  linkVisible(db: Kysely<DB>, linkId: string) {
    return sql<{ id: string; es_principal: boolean }>`
      select l.id, l.es_principal
        from campana.links_referido l
       where l.id = ${linkId}::uuid
         and l.miembro_id in (select miembro_id from campana.mi_red())
    `
      .execute(db)
      .then((r) => r.rows[0]);
  }

  async territoriosVisiblesEntre(db: Kysely<DB>, territorioIds: number[]): Promise<number[]> {
    if (!territorioIds.length) return [];
    const { rows } = await sql<{ territorio_id: number }>`
      select territorio_id from acceso.territorios_visibles() where territorio_id = any(${sql.val(territorioIds)}::integer[])
    `.execute(db);
    return rows.map((r) => r.territorio_id);
  }

  async municipiosEntre(db: Kysely<DB>, territorioIds: number[]): Promise<number[]> {
    if (!territorioIds.length) return [];
    const filas = await db
      .selectFrom('territorio.territorios')
      .select('id')
      .where('id', 'in', territorioIds)
      .where('tipo_codigo', '=', 'MUNICIPIO')
      .execute();
    return filas.map((f) => f.id);
  }

  async territorioVisible(db: Kysely<DB>, territorioId: number): Promise<boolean> {
    const { rows } = await sql<{ territorio_id: number }>`
      select territorio_id from acceso.territorios_visibles() where territorio_id = ${territorioId}
    `.execute(db);
    return Boolean(rows[0]);
  }

  async misLinks(db: Kysely<DB>, miembroId: string, urlBase: string) {
    const { rows } = await sql`
      select l.id, l.codigo, ${urlBase} || '/' || l.codigo as url,
             l.es_principal, l.activo, l.creado_en, l.expira_en,
             count(s.persona_id)::integer as simpatizantes
        from campana.links_referido l
        left join campana.simpatizantes s on s.link_referido_id = l.id
       where l.miembro_id = ${miembroId} and l.proposito = 'VOTANTE'
       group by l.id, l.codigo, l.es_principal, l.activo, l.creado_en, l.expira_en
       order by l.es_principal desc, l.creado_en
    `.execute(db);
    return rows;
  }

  async contarLinksActivos(db: Kysely<DB>, miembroId: string): Promise<number> {
    const { rows } = await sql<{ activos: number }>`
      select count(*)::integer as activos from campana.links_referido where miembro_id = ${miembroId} and activo
    `.execute(db);
    return rows[0].activos;
  }

  async crearLink(db: Kysely<DB>, miembroId: string, esPrincipal: boolean): Promise<string> {
    const { rows } = await sql<{ codigo: string }>`
      select campana.crear_link(${miembroId}::uuid, ${esPrincipal}) as codigo
    `.execute(db);
    return rows[0].codigo;
  }

  async actualizarLinkActivo(db: Kysely<DB>, linkId: string, activo: boolean): Promise<void> {
    await db.updateTable('campana.links_referido').set({ activo }).where('id', '=', linkId).execute();
  }

  async arbol(db: Kysely<DB>) {
    const { rows } = await sql`
      select r.miembro_id, r.superior_id, r.cargo_codigo, r.nombre, r.activo,
             r.profundidad, r.camino, k.activos, k.ultimo_registro,
             r.miembro_id = (select m.id from acceso.usuarios u join campana.miembros m on m.persona_id = u.persona_id
                              where u.id = acceso.usuario_actual()) as es_propio
        from campana.v_red_miembros r
        left join campana.v_ranking_miembros k on k.miembro_id = r.miembro_id
       where r.miembro_id in (select miembro_id from campana.miembros_visibles())
       order by r.camino
    `.execute(db);
    return rows;
  }

  personaPorDocumento(db: Kysely<DB>, documentoHash: Buffer) {
    return db
      .selectFrom('personas.personas')
      .select('id')
      .where('tipo_documento_codigo', '=', 'CC')
      .where('documento_hash', '=', documentoHash)
      .executeTakeFirst();
  }

  async crearPersona(db: Kysely<DB>, persona: NuevaPersona): Promise<void> {
    await db
      .insertInto('personas.personas')
      .values({
        id: persona.id,
        tipo_documento_codigo: 'CC',
        documento_hash: persona.documentoHash,
        documento_cifrado: persona.documentoCifrado,
        nombres: persona.nombres,
        apellidos: persona.apellidos,
      })
      .execute();
  }

  miembroPorPersona(db: Kysely<DB>, personaId: string) {
    return db.selectFrom('campana.miembros').select('id').where('persona_id', '=', personaId).executeTakeFirst();
  }

  crearMiembro(db: Kysely<DB>, miembro: NuevoMiembro) {
    return db
      .insertInto('campana.miembros')
      .values({ persona_id: miembro.personaId, cargo_codigo: miembro.cargo, superior_id: miembro.superiorId })
      .returning('id')
      .executeTakeFirstOrThrow();
  }

  linkPrincipalDe(db: Kysely<DB>, miembroId: string) {
    return db
      .selectFrom('campana.links_referido')
      .select('codigo')
      .where('miembro_id', '=', miembroId)
      .where('es_principal', '=', true)
      .executeTakeFirst();
  }

  async crearTelefono(db: Kysely<DB>, personaId: string, hash: Buffer, cifrado: Buffer): Promise<void> {
    await db
      .insertInto('personas.telefonos')
      .values({ persona_id: personaId, telefono_hash: hash, telefono_cifrado: cifrado, es_principal: true })
      .onConflict((oc) => oc.doNothing())
      .execute();
  }

  async asignarTerritoriosMiembro(db: Kysely<DB>, miembroId: string, territorioIds: number[]): Promise<void> {
    if (!territorioIds.length) return;
    await db
      .insertInto('campana.miembro_territorios')
      .values(territorioIds.map((territorio_id) => ({ miembro_id: miembroId, territorio_id })))
      .execute();
  }

  actualizarMiembro(db: Kysely<DB>, miembroId: string, cambios: { activo?: boolean; superiorId?: string }) {
    return db
      .updateTable('campana.miembros')
      .set({
        ...(cambios.activo === undefined ? {} : { activo: cambios.activo }),
        ...(cambios.superiorId === undefined ? {} : { superior_id: cambios.superiorId }),
      })
      .where('id', '=', miembroId)
      .returning(['id', 'activo', 'superior_id'])
      .executeTakeFirstOrThrow();
  }

  crearMetaMiembro(db: Kysely<DB>, datos: { miembroId: string; cantidad: number; fechaInicio: string; fechaLimite: string }) {
    return db
      .insertInto('campana.metas_miembro')
      .values({ miembro_id: datos.miembroId, cantidad: datos.cantidad, fecha_inicio: datos.fechaInicio, fecha_limite: datos.fechaLimite })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  crearMetaTerritorio(db: Kysely<DB>, datos: { territorioId: number; cantidad: number; fechaInicio: string; fechaLimite: string }) {
    return db
      .insertInto('campana.metas_territorio')
      .values({ territorio_id: datos.territorioId, cantidad: datos.cantidad, fecha_inicio: datos.fechaInicio, fecha_limite: datos.fechaLimite })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async enlaceLideres(db: Kysely<DB>) {
    const { rows } = await sql<{ codigo: string; cargo_invitado: string; solicitudes_pendientes: number }>`
      select codigo, cargo_invitado, solicitudes_pendientes from campana.mi_enlace_lideres()
    `.execute(db);
    return rows[0];
  }

  async solicitudes(db: Kysely<DB>, estado: string | undefined) {
    const { rows } = await sql<Record<string, unknown> & { telefono_cifrado: Buffer | null }>`
      select * from campana.solicitudes_lider_visibles(${estado ?? null})
    `.execute(db);
    return rows;
  }

  async resolverSolicitud(db: Kysely<DB>, id: string, aprobar: boolean, observacion: string | null) {
    const { rows } = await sql<{ miembro_id: string | null; codigo_link: string | null }>`
      select miembro_id, codigo_link from campana.resolver_solicitud_lider(${id}::uuid, ${aprobar}, ${observacion})
    `.execute(db);
    return rows[0];
  }
}
