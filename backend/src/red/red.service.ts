import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Kysely } from 'kysely';
import { randomUUID } from 'node:crypto';
import { UsuarioSesion } from '../auth/auth.types.js';
import { CifradoService } from '../cifrado/cifrado.service.js';
import { ConflictoError, NoEncontradoError, ReglaNegocioError } from '../comun/errores/errores-dominio.js';
import { DatabaseService } from '../database/database.service.js';
import type { DB } from '../database/db.types.js';
import {
  ActualizarLinkDto,
  ActualizarMiembroDto,
  CrearLinkDto,
  CrearMetaMiembroDto,
  CrearMetaTerritorioDto,
  CrearMiembroDto,
} from './dto/red.dto.js';
import { RedRepositorio } from './red.repositorio.js';

@Injectable()
export class RedService {
  private readonly urlRegistroBase: string;

  constructor(
    private readonly database: DatabaseService,
    private readonly cifrado: CifradoService,
    private readonly repo: RedRepositorio,
    config: ConfigService,
  ) {
    this.urlRegistroBase = config.getOrThrow<string>('URL_REGISTRO_BASE').replace(/\/$/, '');
  }

  async misLinks(usuario: UsuarioSesion) {
    return this.database.comoUsuario(usuario.id, async (trx) => {
      const miembro = await this.miembroDelUsuario(trx, usuario.id);
      return this.repo.misLinks(trx, miembro, this.urlRegistroBase);
    });
  }

  async crearLink(usuario: UsuarioSesion, dto: CrearLinkDto) {
    this.validarFechaFutura(dto.expiraEn);
    return this.database.comoUsuario(usuario.id, async (trx) => {
      const miembro = await this.miembroDelUsuario(trx, usuario.id);
      const activos = await this.repo.contarLinksActivos(trx, miembro);
      if (activos >= 10) throw new ReglaNegocioError('El miembro ya tiene 10 links activos');
      const codigo = await this.repo.crearLink(trx, miembro, false);
      return { codigo, url: `${this.urlRegistroBase}/${codigo}`, es_principal: false, expira_en: dto.expiraEn ?? null };
    });
  }

  async actualizarLink(usuario: UsuarioSesion, linkId: string, dto: ActualizarLinkDto) {
    return this.database.comoUsuario(usuario.id, async (trx) => {
      const link = await this.repo.linkVisible(trx, linkId);
      if (!link) throw new NoEncontradoError('Link no encontrado');
      if (!dto.activo && link.es_principal) throw new ReglaNegocioError('No se puede desactivar el link principal');
      await this.repo.actualizarLinkActivo(trx, linkId, dto.activo);
      return { id: linkId, activo: dto.activo };
    });
  }

  async arbol(usuario: UsuarioSesion) {
    return this.database.comoUsuario(usuario.id, (trx) => this.repo.arbol(trx));
  }

  async crearMiembro(usuario: UsuarioSesion, dto: CrearMiembroDto) {
    return this.database.comoUsuario(usuario.id, async (trx) => {
      if (!(await this.repo.miembroEnRed(trx, dto.superiorId))) throw new NoEncontradoError('Miembro superior no encontrado');
      await this.validarTerritorios(trx, dto.territorioIds ?? []);

      const documento = this.cifrado.normalizarNumero(dto.documento);
      const telefono = dto.telefono ? this.cifrado.normalizarNumero(dto.telefono) : null;
      const documentoHash = this.cifrado.hash(documento);

      let persona = await this.repo.personaPorDocumento(trx, documentoHash);
      if (!persona) {
        const personaId = randomUUID();
        await this.repo.crearPersona(trx, {
          id: personaId,
          documentoHash,
          documentoCifrado: this.cifrado.cifrar(documento),
          nombres: dto.nombres.trim(),
          apellidos: dto.apellidos.trim(),
        });
        persona = { id: personaId };
      }

      const miembroExistente = await this.repo.miembroPorPersona(trx, persona.id);
      if (miembroExistente) throw new ConflictoError('La persona ya pertenece a la estructura');

      const miembro = await this.repo.crearMiembro(trx, { personaId: persona.id, cargo: dto.cargo, superiorId: dto.superiorId });
      const link = await this.repo.linkPrincipalDe(trx, miembro.id);
      if (!link) throw new Error('No fue posible crear el link principal');

      if (telefono) {
        await this.repo.crearTelefono(trx, persona.id, this.cifrado.hash(telefono), this.cifrado.cifrar(telefono));
      }
      if (dto.territorioIds?.length) {
        await this.repo.asignarTerritoriosMiembro(trx, miembro.id, dto.territorioIds);
      }
      return { miembroId: miembro.id, codigoLink: link.codigo, urlLink: `${this.urlRegistroBase}/${link.codigo}` };
    });
  }

  async actualizarMiembro(usuario: UsuarioSesion, miembroId: string, dto: ActualizarMiembroDto) {
    return this.database.comoUsuario(usuario.id, async (trx) => {
      const propio = await this.miembroDelUsuario(trx, usuario.id);
      if (propio === miembroId) throw new ReglaNegocioError('No puede modificarse a sí mismo');
      if (!(await this.repo.miembroEnRed(trx, miembroId))) throw new NoEncontradoError('Miembro no encontrado');
      if (dto.superiorId !== undefined && !(await this.repo.miembroEnRed(trx, dto.superiorId))) {
        throw new NoEncontradoError('Miembro superior no encontrado');
      }
      if (dto.activo === undefined && dto.superiorId === undefined) throw new ReglaNegocioError('Debe indicar un cambio');
      return this.repo.actualizarMiembro(trx, miembroId, { activo: dto.activo, superiorId: dto.superiorId });
    });
  }

  async crearMetaMiembro(usuario: UsuarioSesion, dto: CrearMetaMiembroDto) {
    this.validarRango(dto.fechaInicio, dto.fechaLimite);
    return this.database.comoUsuario(usuario.id, async (trx) => {
      if (!(await this.repo.miembroEnRed(trx, dto.miembroId))) throw new NoEncontradoError('Miembro no encontrado');
      return this.repo.crearMetaMiembro(trx, dto);
    });
  }

  async crearMetaTerritorio(usuario: UsuarioSesion, dto: CrearMetaTerritorioDto) {
    this.validarRango(dto.fechaInicio, dto.fechaLimite);
    return this.database.comoUsuario(usuario.id, async (trx) => {
      if (!(await this.repo.territorioVisible(trx, dto.territorioId))) throw new NoEncontradoError('Territorio no encontrado');
      return this.repo.crearMetaTerritorio(trx, dto);
    });
  }

  private async miembroDelUsuario(trx: Kysely<DB>, usuarioId: string): Promise<string> {
    const miembro = await this.repo.miembroDelUsuario(trx, usuarioId);
    if (!miembro) throw new NoEncontradoError('El usuario no es miembro de la campaña');
    return miembro.id;
  }

  private async validarTerritorios(trx: Kysely<DB>, territorioIds: number[]) {
    if (!territorioIds.length) return;
    const visibles = await this.repo.territoriosVisiblesEntre(trx, territorioIds);
    if (visibles.length !== new Set(territorioIds).size) throw new ReglaNegocioError('Uno o más territorios no están disponibles');
  }

  private validarFechaFutura(fecha?: string) {
    if (fecha && new Date(fecha).getTime() <= Date.now()) throw new ReglaNegocioError('La fecha de expiración debe ser futura');
  }

  private validarRango(inicio: string, limite: string) {
    if (new Date(`${limite}T00:00:00Z`) < new Date(`${inicio}T00:00:00Z`)) {
      throw new ReglaNegocioError('La fecha límite debe ser posterior o igual a la fecha de inicio');
    }
  }
}
