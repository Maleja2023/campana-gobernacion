import { Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import type { DB } from '../database/db.types.js';

export interface ResultadoRegistro {
  resultado: string;
  persona_id: string | null;
  mensaje: string;
}

export interface DatosRegistro {
  documentoHash: Buffer;
  documentoCifrado: Buffer;
  nombres: string;
  apellidos: string;
  telefonoHash: Buffer | null;
  telefonoCifrado: Buffer | null;
  territorioId: number;
  codigoLink: string;
  canal: string;
  politicaVersion: number;
  finalidades: string[];
  aceptacionTexto: string;
  jornadaId: number | null;
  puestoId: number | null;
  necesidad: string | null;
  categoria: string | null;
  lon: number | null;
  lat: number | null;
  ip: string | null;
  userAgent: string | null;
}

export interface FiltrosListado {
  municipioId?: number;
  territoriosDescendientes?: number[];
  estado?: string;
  texto?: string;
  liderId?: string;
  desde?: string;
  hasta?: string;
  pagina: number;
  porPagina: number;
}

/** null en un campo significa "no cambiar" (campana.editar_simpatizante, migración 21). */
export interface DatosEdicion {
  personaId: string;
  nombres: string | null;
  apellidos: string | null;
  territorioId: number | null;
  telefonoHash: Buffer | null;
  telefonoCifrado: Buffer | null;
  puestoId: number | null;
}

export interface EntradaHistorial {
  id: number;
  accion: string;
  cambios: Record<string, { antes?: string | null; despues?: string | null }>;
  detalle: string | null;
  usuario: string | null;
  ocurrido_en: string;
}

export interface LiderParaRegistro {
  miembro_id: string;
  nombre: string;
  cargo_codigo: string;
  codigo_link: string;
  municipio: string | null;
}

export interface FiltrosExportar {
  municipioId?: number;
  territoriosDescendientes?: number[];
  estado?: string;
  texto?: string;
}

export interface DatosExportacion {
  motivo: string;
  formato: 'XLSX';
  cantidad: number;
  territorios: number[];
}

// Techo defensivo: evita que un filtro demasiado amplio genere un archivo
// gigante en memoria. Muy por encima de lo que hoy tiene el departamento.
const TOPE_FILAS_EXPORTAR = 20_000;

/** Todas las consultas SQL del módulo de simpatizantes. Sin reglas de negocio. */
@Injectable()
export class SimpatizantesRepositorio {
  politicaVigente(db: Kysely<DB>) {
    return db
      .selectFrom('cumplimiento.politicas_tratamiento')
      .select(['version', 'texto'])
      .where('vigente_hasta', 'is', null)
      .orderBy('version', 'desc')
      .executeTakeFirst();
  }

  finalidadesDePolitica(db: Kysely<DB>, version: number) {
    return db
      .selectFrom('cumplimiento.politica_finalidades as pf')
      .innerJoin('cumplimiento.finalidades as f', 'f.codigo', 'pf.finalidad_codigo')
      .select(['f.codigo', 'f.descripcion'])
      .where('pf.politica_version', '=', version)
      .orderBy('f.codigo')
      .execute();
  }

  /**
   * Valida un enlace de registro para un visitante anónimo. Usa
   * campana.lider_de_link() (migración 23, SECURITY DEFINER): la seguridad por
   * fila no deja a un anónimo leer los datos del líder en personas.personas.
   */
  async linkValido(db: Kysely<DB>, codigo: string) {
    const { rows } = await sql<{ lider: string | null }>`select campana.lider_de_link(${codigo}) as lider`.execute(db);
    const lider = rows[0]?.lider;
    return lider ? { nombres: lider } : undefined;
  }

  jornadaMasReciente(db: Kysely<DB>) {
    return db.selectFrom('electoral.jornadas').select('id').orderBy('fecha', 'desc').executeTakeFirst();
  }

  linkPrincipalDeUsuario(db: Kysely<DB>, usuarioId: string) {
    return db
      .selectFrom('acceso.usuarios as u')
      .innerJoin('campana.miembros as m', 'm.persona_id', 'u.persona_id')
      .innerJoin('campana.links_referido as l', 'l.miembro_id', 'm.id')
      .select('l.codigo')
      .where('u.id', '=', usuarioId)
      .where('l.es_principal', '=', true)
      .where('l.activo', '=', true)
      .executeTakeFirst();
  }

  async descendientesDe(db: Kysely<DB>, territorioId: number): Promise<number[]> {
    const { rows } = await sql<{ territorio_id: number }>`
      select territorio_id from territorio.descendientes(${territorioId})
    `.execute(db);
    return rows.map((r) => r.territorio_id);
  }

  /** true si `miembroId` está dentro de la red del usuario de la sesión (campana.mi_red()). */
  async miembroEnMiRed(db: Kysely<DB>, miembroId: string): Promise<boolean> {
    const { rows } = await sql`select 1 from campana.mi_red() where miembro_id = ${miembroId}::uuid`.execute(db);
    return rows.length > 0;
  }

  async registrar(db: Kysely<DB>, datos: DatosRegistro): Promise<ResultadoRegistro> {
    const { rows } = await sql<ResultadoRegistro>`
      select * from campana.registrar_simpatizante(
        'CC', ${datos.documentoHash}, ${datos.documentoCifrado},
        ${datos.nombres}, ${datos.apellidos},
        ${datos.telefonoHash}, ${datos.telefonoCifrado},
        ${datos.territorioId}, ${datos.codigoLink}, ${datos.canal}, ${datos.politicaVersion}::smallint,
        ${sql.val(datos.finalidades)}::text[], ${datos.aceptacionTexto}, now(),
        ${datos.jornadaId}::smallint, ${datos.puestoId}::integer,
        ${datos.necesidad}, ${datos.categoria},
        ${datos.lon}::double precision, ${datos.lat}::double precision,
        ${datos.ip}::inet, ${datos.userAgent}
      )
    `.execute(db);
    return rows[0];
  }

  async listar(db: Kysely<DB>, filtros: FiltrosListado) {
    let consulta = db.selectFrom('campana.v_simpatizantes').selectAll();
    let conteo = db.selectFrom('campana.v_simpatizantes').select(({ fn }) => fn.countAll<number>().as('total'));

    if (filtros.municipioId !== undefined) {
      consulta = consulta.where('municipio_id', '=', filtros.municipioId);
      conteo = conteo.where('municipio_id', '=', filtros.municipioId);
    }
    if (filtros.territoriosDescendientes !== undefined) {
      consulta = consulta.where('territorio_residencia_id', 'in', filtros.territoriosDescendientes);
      conteo = conteo.where('territorio_residencia_id', 'in', filtros.territoriosDescendientes);
    }
    if (filtros.estado !== undefined) {
      consulta = consulta.where('estado_codigo', '=', filtros.estado);
      conteo = conteo.where('estado_codigo', '=', filtros.estado);
    }
    if (filtros.texto) {
      const patron = `%${filtros.texto}%`;
      consulta = consulta.where((eb) => eb.or([eb('nombres', 'ilike', patron), eb('apellidos', 'ilike', patron)]));
      conteo = conteo.where((eb) => eb.or([eb('nombres', 'ilike', patron), eb('apellidos', 'ilike', patron)]));
    }
    if (filtros.liderId !== undefined) {
      consulta = consulta.where('referido_por_miembro_id', '=', filtros.liderId);
      conteo = conteo.where('referido_por_miembro_id', '=', filtros.liderId);
    }
    if (filtros.desde !== undefined) {
      consulta = consulta.where(sql`capturado_en::date`, '>=', filtros.desde);
      conteo = conteo.where(sql`capturado_en::date`, '>=', filtros.desde);
    }
    if (filtros.hasta !== undefined) {
      consulta = consulta.where(sql`capturado_en::date`, '<=', filtros.hasta);
      conteo = conteo.where(sql`capturado_en::date`, '<=', filtros.hasta);
    }

    const [datos, total] = await Promise.all([
      consulta
        .orderBy('capturado_en', 'desc')
        .limit(filtros.porPagina)
        .offset((filtros.pagina - 1) * filtros.porPagina)
        .execute(),
      conteo.executeTakeFirstOrThrow(),
    ]);
    return { datos, total: Number(total.total) };
  }

  documentoCifradoDe(db: Kysely<DB>, personaId: string) {
    return db.selectFrom('personas.personas').select('documento_cifrado').where('id', '=', personaId).executeTakeFirst();
  }

  async registrarConsultaAuditada(db: Kysely<DB>, personaId: string): Promise<void> {
    await sql`select auditoria.registrar_consulta('personas', 'personas', ${personaId})`.execute(db);
  }

  /** true si `personaId` es un simpatizante visible para el usuario de la sesión (RLS). */
  async visible(db: Kysely<DB>, personaId: string): Promise<boolean> {
    const fila = await db
      .selectFrom('campana.simpatizantes')
      .select('persona_id')
      .where('persona_id', '=', personaId)
      .executeTakeFirst();
    return fila !== undefined;
  }

  async editar(db: Kysely<DB>, datos: DatosEdicion): Promise<void> {
    await sql`
      select campana.editar_simpatizante(
        ${datos.personaId}::uuid, ${datos.nombres}::text, ${datos.apellidos}::text,
        ${datos.territorioId}::integer, ${datos.telefonoHash}::bytea, ${datos.telefonoCifrado}::bytea,
        ${datos.puestoId}::integer
      )
    `.execute(db);
  }

  async retirar(db: Kysely<DB>, personaId: string, motivo: string): Promise<void> {
    await sql`select campana.retirar_simpatizante(${personaId}::uuid, ${motivo}::text)`.execute(db);
  }

  async reactivar(db: Kysely<DB>, personaId: string): Promise<void> {
    await sql`select campana.reactivar_simpatizante(${personaId}::uuid)`.execute(db);
  }

  /** Historial legible (migración 24). RLS: solo de personas visibles para el usuario. */
  async historial(db: Kysely<DB>, personaId: string): Promise<EntradaHistorial[]> {
    const { rows } = await sql<EntradaHistorial>`
      select h.id::integer as id, h.accion, h.cambios, h.detalle,
             nullif(btrim(coalesce(p.nombres, '') || ' ' || coalesce(p.apellidos, '')), '') as usuario,
             h.ocurrido_en
        from campana.historial_simpatizante h
        left join acceso.usuarios u on u.id = h.usuario_id
        left join personas.personas p on p.id = u.persona_id
       where h.persona_id = ${personaId}::uuid
       order by h.ocurrido_en desc, h.id desc
    `.execute(db);
    return rows;
  }

  /** Líderes que el usuario puede elegir como "líder que refiere" (migración 24). */
  async lideresParaRegistro(db: Kysely<DB>): Promise<LiderParaRegistro[]> {
    const { rows } = await sql<LiderParaRegistro>`
      select miembro_id, nombre, cargo_codigo, codigo_link, municipio
        from campana.lideres_para_registro()
    `.execute(db);
    return rows;
  }

  /** Mismas columnas que expone campana.v_simpatizantes vía listar(): nunca
   * documento ni teléfono. Sujeto a las mismas RLS (alcance territorial/de red). */
  async paraExportar(db: Kysely<DB>, filtros: FiltrosExportar) {
    let consulta = db
      .selectFrom('campana.v_simpatizantes')
      .select(['nombres', 'apellidos', 'territorio_residencia', 'municipio', 'municipio_id', 'referido_por', 'canal_codigo', 'estado_codigo', 'capturado_en']);

    if (filtros.municipioId !== undefined) consulta = consulta.where('municipio_id', '=', filtros.municipioId);
    if (filtros.territoriosDescendientes !== undefined) consulta = consulta.where('territorio_residencia_id', 'in', filtros.territoriosDescendientes);
    if (filtros.estado !== undefined) consulta = consulta.where('estado_codigo', '=', filtros.estado);
    if (filtros.texto) {
      const patron = `%${filtros.texto}%`;
      consulta = consulta.where((eb) => eb.or([eb('nombres', 'ilike', patron), eb('apellidos', 'ilike', patron)]));
    }

    return consulta.orderBy('capturado_en', 'desc').limit(TOPE_FILAS_EXPORTAR).execute();
  }

  async registrarExportacion(db: Kysely<DB>, datos: DatosExportacion): Promise<void> {
    await sql`
      select auditoria.registrar_exportacion(
        ${datos.motivo}, ${datos.formato}, ${datos.cantidad}, ${sql.val(datos.territorios)}::integer[]
      )
    `.execute(db);
  }
}
