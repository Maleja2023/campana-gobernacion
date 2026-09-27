import { Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import type { DB } from '../database/db.types.js';

/** Consultas del día de elecciones. Las reglas (permisos, territorio, testigo de la mesa) las aplica la base. */
@Injectable()
export class DiaDRepositorio {
  async jornadas(db: Kysely<DB>) {
    return (await sql`select * from electoral.resumen_jornadas()`.execute(db)).rows;
  }

  async crearJornada(db: Kysely<DB>, nombre: string, tipo: string, fecha: string, copiarDe: number) {
    const { rows } = await sql<{ id: number }>`
      select electoral.crear_jornada(${nombre}, ${tipo}, ${fecha}::date, ${copiarDe}::smallint) as id
    `.execute(db);
    return rows[0].id;
  }

  async opciones(db: Kysely<DB>, corporacion: string) {
    return (await sql`select * from electoral.opciones_jornada(${corporacion})`.execute(db)).rows;
  }

  async guardarCandidato(db: Kysely<DB>, corporacion: string, nombre: string, partido: string | null, propio: boolean) {
    const { rows } = await sql<{ id: number }>`
      select electoral.guardar_candidato(${corporacion}, ${nombre}, ${partido}, ${propio}) as id
    `.execute(db);
    return rows[0].id;
  }

  async quitarCandidato(db: Kysely<DB>, id: number) {
    await sql`select electoral.quitar_candidato(${id}::int)`.execute(db);
  }

  async puestos(db: Kysely<DB>, municipioId: number | null) {
    const { rows } = await sql<Record<string, unknown>>`select * from electoral.puestos_dia_d(${municipioId}::int)`.execute(db);
    return rows.map((r) => ({ ...r, mesas: Number(r.mesas), con_testigo: Number(r.con_testigo), e14_cargados: Number(r.e14_cargados) }));
  }

  async definirMesas(db: Kysely<DB>, puestoId: number, cantidad: number) {
    await sql`select electoral.definir_mesas(${puestoId}::int, ${cantidad}::int)`.execute(db);
  }

  async mesasPuesto(db: Kysely<DB>, puestoId: number) {
    const { rows } = await sql<Record<string, unknown>>`select * from electoral.mesas_puesto(${puestoId}::int)`.execute(db);
    return rows.map((r) => ({ ...r, formularios: Number(r.formularios) }));
  }

  async testigosDisponibles(db: Kysely<DB>) {
    const { rows } = await sql<Record<string, unknown>>`select * from electoral.testigos_disponibles()`.execute(db);
    return rows.map((r) => ({ ...r, mesas: Number(r.mesas) }));
  }

  async asignarTestigo(db: Kysely<DB>, mesaId: number, usuarioId: string | null) {
    await sql`select electoral.asignar_testigo(${mesaId}::int, ${usuarioId}::uuid)`.execute(db);
  }

  async misMesas(db: Kysely<DB>) {
    return (await sql`select * from electoral.mis_mesas()`.execute(db)).rows;
  }

  async cargarE14(db: Kysely<DB>, mesaId: number, corporacion: string, ruta: string, sha256: Buffer, votos: Record<string, number>) {
    const { rows } = await sql<{ formulario_id: string; estado_revision: string; total: number }>`
      select * from electoral.cargar_e14(${mesaId}::int, ${corporacion}, ${ruta}, ${sha256}, ${JSON.stringify(votos)}::jsonb)
    `.execute(db);
    return rows[0];
  }

  async fotoE14(db: Kysely<DB>, formularioId: string) {
    const { rows } = await sql<{ ruta: string; sha256: Buffer }>`select * from electoral.foto_e14(${formularioId}::uuid)`.execute(db);
    return rows[0];
  }

  async revision(db: Kysely<DB>, estado: string | null, municipioId: number | null) {
    return (await sql`select * from electoral.formularios_revision(${estado}, ${municipioId}::int)`.execute(db)).rows;
  }

  async revisar(db: Kysely<DB>, formularioId: string, estado: string, observacion: string | null) {
    await sql`select electoral.revisar_e14(${formularioId}::uuid, ${estado}, ${observacion})`.execute(db);
  }

  async conteo(db: Kysely<DB>, corporacion: string, municipioId: number | null) {
    const { rows } = await sql<{ conteo: unknown }>`select electoral.conteo_rapido(${corporacion}, ${municipioId}::int) as conteo`.execute(db);
    return rows[0].conteo;
  }
}
