import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { UsuarioSesion } from '../auth/auth.types.js';
import { CifradoService } from '../cifrado/cifrado.service.js';
import { DatabaseService } from '../database/database.service.js';
import {
  ActualizarLinkDto,
  ActualizarMiembroDto,
  CrearLinkDto,
  CrearMetaMiembroDto,
  CrearMetaTerritorioDto,
  CrearMiembroDto,
} from './dto/red.dto.js';

interface ErrorBaseDatos {
  code?: string;
  constraint?: string;
  detail?: string;
  message?: string;
  name?: string;
}

@Injectable()
export class RedService {
  private readonly logger = new Logger(RedService.name);
  private readonly urlRegistroBase: string;

  constructor(
    private readonly database: DatabaseService,
    private readonly cifrado: CifradoService,
    config: ConfigService,
  ) {
    this.urlRegistroBase = config.getOrThrow<string>('URL_REGISTRO_BASE').replace(/\/$/, '');
  }

  async misLinks(usuario: UsuarioSesion) {
    return this.database.comoUsuario(usuario.id, async (trx) => {
      const miembro = await this.miembroDelUsuario(trx, usuario.id);
      const { rows } = await sql`
        select l.id, l.codigo, ${this.urlRegistroBase} || '/' || l.codigo as url,
               l.es_principal, l.activo, l.creado_en, l.expira_en,
               count(s.persona_id)::integer as simpatizantes
          from campana.links_referido l
          left join campana.simpatizantes s on s.link_referido_id = l.id
         where l.miembro_id = ${miembro}
         group by l.id, l.codigo, l.es_principal, l.activo, l.creado_en, l.expira_en
         order by l.es_principal desc, l.creado_en
      `.execute(trx);
      return rows;
    });
  }

  async crearLink(usuario: UsuarioSesion, dto: CrearLinkDto) {
    this.validarFechaFutura(dto.expiraEn);
    return this.database.comoUsuario(usuario.id, async (trx) => {
      const miembro = await this.miembroDelUsuario(trx, usuario.id);
      const { rows: cantidad } = await sql<{ activos: number }>`
        select count(*)::integer as activos
          from campana.links_referido
         where miembro_id = ${miembro} and activo
      `.execute(trx);
      if (cantidad[0].activos >= 10) throw new BadRequestException('El miembro ya tiene 10 links activos');
      try {
        const { rows } = await sql<{ codigo: string }>`
          select campana.crear_link(${miembro}::uuid, false) as codigo
        `.execute(trx);
        return {
          codigo: rows[0].codigo,
          url: `${this.urlRegistroBase}/${rows[0].codigo}`,
          es_principal: false,
          expira_en: dto.expiraEn ?? null,
        };
      } catch (error) {
        throw this.errorDeBase(error);
      }
    });
  }

  async actualizarLink(usuario: UsuarioSesion, linkId: string, dto: ActualizarLinkDto) {
    return this.database.comoUsuario(usuario.id, async (trx) => {
      const link = await this.linkVisible(trx, linkId);
      if (!link) throw new NotFoundException('Link no encontrado');
      if (!dto.activo && link.es_principal) throw new BadRequestException('No se puede desactivar el link principal');
      await trx.updateTable('campana.links_referido').set({ activo: dto.activo }).where('id', '=', linkId).execute();
      return { id: linkId, activo: dto.activo };
    });
  }

  async arbol(usuario: UsuarioSesion) {
    return this.database.comoUsuario(usuario.id, async (trx) => {
      const { rows } = await sql`
        select r.miembro_id, r.superior_id, r.cargo_codigo, r.nombre, r.activo,
               r.profundidad, r.camino, k.activos, k.ultimo_registro
          from campana.v_red_miembros r
          left join campana.v_ranking_miembros k on k.miembro_id = r.miembro_id
         where r.miembro_id in (select miembro_id from campana.mi_red())
         order by r.camino
      `.execute(trx);
      return rows;
    });
  }

  async crearMiembro(usuario: UsuarioSesion, dto: CrearMiembroDto) {
    return this.database.comoUsuario(usuario.id, async (trx) => {
      const superiorVisible = await this.miembroEnRed(trx, dto.superiorId);
      if (!superiorVisible) throw new NotFoundException('Miembro superior no encontrado');
      await this.validarTerritorios(trx, dto.territorioIds ?? []);

      const documento = this.cifrado.normalizarNumero(dto.documento);
      const telefono = dto.telefono ? this.cifrado.normalizarNumero(dto.telefono) : null;
      const documentoHash = this.cifrado.hash(documento);
      let persona = await trx
        .selectFrom('personas.personas')
        .select('id')
        .where('tipo_documento_codigo', '=', 'CC')
        .where('documento_hash', '=', documentoHash)
        .executeTakeFirst();

      try {
        if (!persona) {
          const personaId = randomUUID();
          await trx.insertInto('personas.personas').values({
              id: personaId,
              tipo_documento_codigo: 'CC',
              documento_hash: documentoHash,
              documento_cifrado: this.cifrado.cifrar(documento),
              nombres: dto.nombres.trim(),
              apellidos: dto.apellidos.trim(),
            }).execute();
          persona = { id: personaId };
        }
        const miembroExistente = await trx
          .selectFrom('campana.miembros')
          .select('id')
          .where('persona_id', '=', persona.id)
          .executeTakeFirst();
        if (miembroExistente) throw new ConflictException('La persona ya pertenece a la estructura');

        const miembro = await trx
          .insertInto('campana.miembros')
          .values({ persona_id: persona.id, cargo_codigo: dto.cargo, superior_id: dto.superiorId })
          .returning('id')
          .executeTakeFirstOrThrow();
        const link = await trx
          .selectFrom('campana.links_referido')
          .select('codigo')
          .where('miembro_id', '=', miembro.id)
          .where('es_principal', '=', true)
          .executeTakeFirst();
        if (!link) throw new InternalServerErrorException('No fue posible crear el link principal');
        if (telefono) {
          await trx.insertInto('personas.telefonos').values({ persona_id: persona.id, telefono_hash: this.cifrado.hash(telefono), telefono_cifrado: this.cifrado.cifrar(telefono), es_principal: true }).onConflict((oc) => oc.doNothing()).execute();
        }
        if (dto.territorioIds?.length) {
          await trx.insertInto('campana.miembro_territorios').values(dto.territorioIds.map((territorioId) => ({ miembro_id: miembro.id, territorio_id: territorioId }))).execute();
        }
        return { miembroId: miembro.id, codigoLink: link.codigo, urlLink: `${this.urlRegistroBase}/${link.codigo}` };
      } catch (error) {
        throw this.errorDeBase(error);
      }
    });
  }

  async actualizarMiembro(usuario: UsuarioSesion, miembroId: string, dto: ActualizarMiembroDto) {
    return this.database.comoUsuario(usuario.id, async (trx) => {
      const propio = await this.miembroDelUsuario(trx, usuario.id);
      if (propio === miembroId) throw new BadRequestException('No puede modificarse a sí mismo');
      if (!(await this.miembroEnRed(trx, miembroId))) throw new NotFoundException('Miembro no encontrado');
      if (dto.superiorId !== undefined && !(await this.miembroEnRed(trx, dto.superiorId))) throw new NotFoundException('Miembro superior no encontrado');
      if (dto.activo === undefined && dto.superiorId === undefined) throw new BadRequestException('Debe indicar un cambio');
      try {
        const actualizado = await trx.updateTable('campana.miembros').set({ ...(dto.activo === undefined ? {} : { activo: dto.activo }), ...(dto.superiorId === undefined ? {} : { superior_id: dto.superiorId }) }).where('id', '=', miembroId).returning(['id', 'activo', 'superior_id']).executeTakeFirstOrThrow();
        return actualizado;
      } catch (error) {
        throw this.errorDeBase(error);
      }
    });
  }

  async crearMetaMiembro(usuario: UsuarioSesion, dto: CrearMetaMiembroDto) {
    this.validarRango(dto.fechaInicio, dto.fechaLimite);
    return this.database.comoUsuario(usuario.id, async (trx) => {
      if (!(await this.miembroEnRed(trx, dto.miembroId))) throw new NotFoundException('Miembro no encontrado');
      try {
        return await trx.insertInto('campana.metas_miembro').values({ miembro_id: dto.miembroId, cantidad: dto.cantidad, fecha_inicio: dto.fechaInicio, fecha_limite: dto.fechaLimite }).returningAll().executeTakeFirstOrThrow();
      } catch (error) {
        throw this.errorDeBase(error);
      }
    });
  }

  async crearMetaTerritorio(usuario: UsuarioSesion, dto: CrearMetaTerritorioDto) {
    this.validarRango(dto.fechaInicio, dto.fechaLimite);
    return this.database.comoUsuario(usuario.id, async (trx) => {
      const { rows } = await sql<{ territorio_id: number }>`
        select territorio_id from acceso.territorios_visibles() where territorio_id = ${dto.territorioId}
      `.execute(trx);
      if (!rows[0]) throw new NotFoundException('Territorio no encontrado');
      try {
        return await trx.insertInto('campana.metas_territorio').values({ territorio_id: dto.territorioId, cantidad: dto.cantidad, fecha_inicio: dto.fechaInicio, fecha_limite: dto.fechaLimite }).returningAll().executeTakeFirstOrThrow();
      } catch (error) {
        throw this.errorDeBase(error);
      }
    });
  }

  private async miembroDelUsuario(trx: any, usuarioId: string): Promise<string> {
    const miembro = await trx.selectFrom('acceso.usuarios as u').innerJoin('campana.miembros as m', 'm.persona_id', 'u.persona_id').select('m.id').where('u.id', '=', usuarioId).executeTakeFirst();
    if (!miembro) throw new NotFoundException('El usuario no es miembro de la campaña');
    return miembro.id;
  }

  private async miembroEnRed(trx: any, miembroId: string): Promise<boolean> {
    const { rows } = await sql<{ miembro_id: string }>`select miembro_id from campana.mi_red() where miembro_id = ${miembroId}::uuid`.execute(trx);
    return Boolean(rows[0]);
  }

  private async linkVisible(trx: any, linkId: string) {
    const { rows } = await sql<{ id: string; es_principal: boolean }>`
      select l.id, l.es_principal
        from campana.links_referido l
       where l.id = ${linkId}::uuid
         and l.miembro_id in (select miembro_id from campana.mi_red())
    `.execute(trx);
    return rows[0];
  }

  private async validarTerritorios(trx: any, territorioIds: number[]) {
    if (!territorioIds.length) return;
    const { rows } = await sql<{ territorio_id: number }>`select territorio_id from acceso.territorios_visibles() where territorio_id = any(${sql.val(territorioIds)}::integer[])`.execute(trx);
    if (rows.length !== new Set(territorioIds).size) throw new BadRequestException('Uno o más territorios no están disponibles');
  }

  private validarFechaFutura(fecha?: string) {
    if (fecha && new Date(fecha).getTime() <= Date.now()) throw new BadRequestException('La fecha de expiración debe ser futura');
  }

  private validarRango(inicio: string, limite: string) {
    if (new Date(`${limite}T00:00:00Z`) < new Date(`${inicio}T00:00:00Z`)) throw new BadRequestException('La fecha límite debe ser posterior o igual a la fecha de inicio');
  }

  private errorDeBase(error: unknown): Error {
    const detalle = error as ErrorBaseDatos;
    if (detalle.code === 'P0001') return new BadRequestException(detalle.message ?? 'Regla de negocio no permitida');
    if (detalle.code === '23505') {
      this.logger.warn(`Conflicto de unicidad en base de datos (${detalle.constraint ?? 'restricción desconocida'})`);
      return new ConflictException('El registro ya existe');
    }
    this.logger.error(`Error inesperado de base de datos (${detalle.code ?? detalle.name ?? 'desconocido'})`);
    return new InternalServerErrorException('No fue posible completar la operación');
  }
}