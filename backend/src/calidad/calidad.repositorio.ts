import { Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import type { DB } from '../database/db.types.js';

export interface FilaAlerta {
  id: string;
  tipo_codigo: string;
  tipo_descripcion: string;
  severidad: string;
  estado: string;
  detectada_en: string;
  observacion: string | null;
  resuelta_en: string | null;
  personas: number;
  miembros: number;
}

// Nunca documento ni teléfono: solo lo necesario para decidir cómo resolver.
export interface PersonaAlerta {
  id: string;
  nombres: string;
  apellidos: string;
  zona: string | null;
  referido_por: string | null;
}

export interface MiembroAlerta {
  id: string;
  nombres: string;
  apellidos: string;
  cargo_codigo: string;
  zona: string | null;
  referido_por: string | null;
}

/** Todas las consultas SQL del módulo de calidad (alertas). Sin reglas de negocio. */
@Injectable()
export class CalidadRepositorio {
  async listar(db: Kysely<DB>, estados: string[]): Promise<FilaAlerta[]> {
    const { rows } = await sql<FilaAlerta>`
      select a.id, a.tipo_codigo, t.descripcion as tipo_descripcion, t.severidad,
             a.estado, a.detectada_en, a.observacion, a.resuelta_en,
             (select count(*) from calidad.alerta_personas ap where ap.alerta_id = a.id)::int as personas,
             (select count(*) from calidad.alerta_miembros am where am.alerta_id = a.id)::int as miembros
        from calidad.alertas a
        join calidad.tipos_alerta t on t.codigo = a.tipo_codigo
       where a.estado = any(${sql.val(estados)}::text[])
       order by a.detectada_en desc
    `.execute(db);
    return rows;
  }

  /** Simpatizantes involucrados: nombre, zona de residencia y líder que los refirió.
   * Nunca documento ni teléfono (calidad-backend, regla explícita). */
  async personasDeAlerta(db: Kysely<DB>, alertaId: string): Promise<PersonaAlerta[]> {
    const { rows } = await sql<PersonaAlerta>`
      select p.id, p.nombres, p.apellidos,
             t.nombre as zona,
             nullif(trim(concat(lp.nombres, ' ', lp.apellidos)), '') as referido_por
        from calidad.alerta_personas ap
        join personas.personas p on p.id = ap.persona_id
        left join campana.simpatizantes s on s.persona_id = p.id
        left join territorio.territorios t on t.id = s.territorio_residencia_id
        left join campana.links_referido l on l.id = s.link_referido_id
        left join campana.miembros m on m.id = l.miembro_id
        left join personas.personas lp on lp.id = m.persona_id
       where ap.alerta_id = ${alertaId}::uuid
       order by p.nombres, p.apellidos
    `.execute(db);
    return rows;
  }

  /** Líderes involucrados: nombre, cargo, sus zonas de trabajo y su superior. */
  async miembrosDeAlerta(db: Kysely<DB>, alertaId: string): Promise<MiembroAlerta[]> {
    const { rows } = await sql<MiembroAlerta>`
      select m.id, p.nombres, p.apellidos, m.cargo_codigo,
             (select string_agg(t.nombre, ', ' order by t.nombre)
                from campana.miembro_territorios mt
                join territorio.territorios t on t.id = mt.territorio_id
               where mt.miembro_id = m.id) as zona,
             nullif(trim(concat(sp.nombres, ' ', sp.apellidos)), '') as referido_por
        from calidad.alerta_miembros am
        join campana.miembros m on m.id = am.miembro_id
        join personas.personas p on p.id = m.persona_id
        left join campana.miembros sup on sup.id = m.superior_id
        left join personas.personas sp on sp.id = sup.persona_id
       where am.alerta_id = ${alertaId}::uuid
       order by p.nombres, p.apellidos
    `.execute(db);
    return rows;
  }

  async resolver(db: Kysely<DB>, alertaId: string, estado: string, observacion: string): Promise<void> {
    await sql`select calidad.resolver_alerta(${alertaId}::uuid, ${estado}, ${observacion})`.execute(db);
  }

  /** Estado actual si `alertaId` existe y es visible para el usuario de la sesión
   * (RLS por permiso ALERTA_GESTIONAR); undefined si no existe o no es visible. */
  async estadoDe(db: Kysely<DB>, alertaId: string): Promise<string | undefined> {
    const fila = await db.selectFrom('calidad.alertas').select('estado').where('id', '=', alertaId).executeTakeFirst();
    return fila?.estado;
  }
}
