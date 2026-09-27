import { Injectable } from '@nestjs/common';
import { randomInt, randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import { MfaRepositorio } from '../auth/mfa.repositorio.js';
import type { UsuarioSesion } from '../auth/auth.types.js';
import { hashearClave } from '../auth/claves.js';
import { CifradoService } from '../cifrado/cifrado.service.js';
import { AuditoriaRepositorio } from '../comun/auditoria/auditoria.repositorio.js';
import { ConflictoError, NoEncontradoError, PermisoError, ReglaNegocioError } from '../comun/errores/errores-dominio.js';
import { DatabaseService } from '../database/database.service.js';
import type { DB } from '../database/db.types.js';
import type { ActualizarUsuarioDto, CrearUsuarioDto } from './dto/usuarios.dto.js';
import { UsuariosRepositorio } from './usuarios.repositorio.js';

const CARACTERES_TEMPORALES = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

@Injectable()
export class UsuariosService {
  constructor(
    private readonly database: DatabaseService,
    private readonly cifrado: CifradoService,
    private readonly repo: UsuariosRepositorio,
    private readonly mfaRepo: MfaRepositorio,
    private readonly auditoria: AuditoriaRepositorio,
  ) {}

  async listar(usuario: UsuarioSesion, texto: string | undefined, activo: boolean | undefined, pagina: number, porPagina: number) {
    return this.database.comoUsuario(usuario.id, async (trx) => {
      const limite = Math.min(porPagina, 100);
      const offset = (pagina - 1) * limite;
      const { datos, total } = await this.repo.listar(trx, { texto, activo, limite, offset });
      return { datos, total, pagina, porPagina: limite };
    });
  }

  async rolesAsignables(usuario: UsuarioSesion) {
    return this.database.comoUsuario(usuario.id, (trx) => this.repo.rolesAsignables(trx));
  }

  async crear(usuario: UsuarioSesion, dto: CrearUsuarioDto) {
    return this.database.comoUsuario(usuario.id, async (trx) => {
      const asignables = await this.repo.rolesPermitidos(trx);
      this.validarRoles(dto.roles, asignables);
      const territorioIds = await this.territoriosSegunRol(trx, dto.roles, dto.territorioIds);
      await this.validarTerritorios(trx, territorioIds);
      this.validarReglasRoles(dto.roles, territorioIds);

      const personaId = await this.resolverPersona(trx, dto);
      const existente = await this.repo.usuarioPorPersona(trx, personaId);
      if (existente) throw new ConflictoError('La persona ya tiene un usuario');

      const login = dto.login.trim().toLowerCase();
      const claveTemporal = this.claveTemporal();
      const usuarioNuevo = await this.repo.crearUsuario(trx, {
        id: randomUUID(),
        login,
        passwordHash: await hashearClave(claveTemporal),
        personaId,
      });
      await this.repo.reemplazarRolesYTerritorios(trx, usuarioNuevo.id, dto.roles, territorioIds);
      return { usuarioId: usuarioNuevo.id, login, claveTemporal };
    });
  }

  async actualizar(actor: UsuarioSesion, usuarioId: string, dto: ActualizarUsuarioDto) {
    return this.database.comoUsuario(actor.id, async (trx) => {
      this.validarNoPropio(actor, usuarioId);
      const objetivo = await this.usuarioAdministrable(trx, usuarioId);
      const roles = dto.roles ?? objetivo.roles;
      const asignables = await this.repo.rolesPermitidos(trx);
      this.validarRoles(roles, asignables);
      const territorios = await this.territoriosSegunRol(trx, roles, dto.territorioIds ?? objetivo.territorios);
      await this.validarTerritorios(trx, territorios);
      this.validarReglasRoles(roles, territorios);

      if (dto.activo !== undefined) {
        await this.repo.actualizarActivo(trx, usuarioId, dto.activo);
        if (!dto.activo) await this.repo.cerrarSesionesDe(trx, usuarioId);
      }
      await this.repo.reemplazarRolesYTerritorios(trx, usuarioId, roles, territorios);
      return { usuarioId, activo: dto.activo ?? objetivo.activo, roles, territorioIds: territorios };
    });
  }

  async restablecerClave(actor: UsuarioSesion, usuarioId: string) {
    return this.database.comoUsuario(actor.id, async (trx) => {
      this.validarNoPropio(actor, usuarioId);
      await this.usuarioAdministrable(trx, usuarioId);
      const claveTemporal = this.claveTemporal();
      await this.repo.actualizarClave(trx, usuarioId, await hashearClave(claveTemporal));
      await this.repo.cerrarSesionesDe(trx, usuarioId);
      return { claveTemporal };
    });
  }

  /** Borra el doble factor y sus códigos de recuperación (ej. el celular se perdió) y cierra sus sesiones. */
  async restablecerMfa(actor: UsuarioSesion, usuarioId: string, ip: string | null) {
    return this.database.comoUsuario(actor.id, async (trx) => {
      this.validarNoPropio(actor, usuarioId);
      await this.usuarioAdministrable(trx, usuarioId);
      await this.mfaRepo.borrarTodosLosFactores(trx, usuarioId);
      await this.mfaRepo.borrarCodigosRecuperacion(trx, usuarioId);
      await this.repo.cerrarSesionesDe(trx, usuarioId);
      await this.auditoria.registrarSeguridad(trx, usuarioId, 'MFA_RESTABLECIDO', ip);
      return { mensaje: 'Doble factor restablecido' };
    });
  }

  private async resolverPersona(trx: Kysely<DB>, dto: CrearUsuarioDto): Promise<string> {
    if (dto.miembroId && (dto.documento || dto.nombres || dto.apellidos)) {
      throw new ReglaNegocioError('Indique miembroId o los datos de una persona nueva, no ambos');
    }
    if (dto.miembroId) {
      const persona = await this.repo.personaDeMiembroEnRed(trx, dto.miembroId);
      if (!persona) throw new NoEncontradoError('Miembro no encontrado');
      return persona.persona_id;
    }
    if (!dto.documento || !dto.nombres || !dto.apellidos) {
      throw new ReglaNegocioError('Debe indicar miembroId o los datos completos de la persona');
    }
    const documento = this.cifrado.normalizarNumero(dto.documento);
    const hash = this.cifrado.hash(documento);
    const visible = await this.repo.personaPorDocumento(trx, hash);
    if (visible) return visible.id;
    const id = randomUUID();
    await this.repo.crearPersona(trx, {
      id,
      documentoHash: hash,
      documentoCifrado: this.cifrado.cifrar(documento),
      nombres: dto.nombres.trim(),
      apellidos: dto.apellidos.trim(),
    });
    return id;
  }

  private async usuarioAdministrable(trx: Kysely<DB>, objetivoId: string): Promise<{ roles: string[]; territorios: number[]; activo: boolean }> {
    const objetivo = await this.repo.usuarioPorId(trx, objetivoId);
    if (!objetivo) throw new NoEncontradoError('Usuario no encontrado');
    const asignables = await this.repo.rolesPermitidos(trx);
    const roles = (await this.repo.rolesDeUsuario(trx, objetivoId)).map((r) => r.rol_codigo);
    // Si el objetivo tiene un rol que el actor no podría asignar, para el actor no existe.
    if (roles.some((rol) => !asignables.includes(rol))) throw new NoEncontradoError('Usuario no encontrado');
    const territorios = (await this.repo.territoriosDeUsuario(trx, objetivoId)).map((t) => t.territorio_id);
    return { roles, territorios, activo: objetivo.activo };
  }

  private async validarTerritorios(trx: Kysely<DB>, ids: number[]) {
    const visibles = await this.repo.territoriosVisiblesEntre(trx, ids);
    if (visibles.length !== new Set(ids).size) throw new ReglaNegocioError('Uno o más territorios no están disponibles');
  }

  private validarRoles(roles: string[], asignables: string[]) {
    if (roles.some((rol) => !asignables.includes(rol))) throw new PermisoError('No puede asignar uno de los roles solicitados');
  }

  /** El candidato ve todo el departamento, siempre: se le asigna el Caquetá
   * sin importar qué territorios se envíen. */
  private async territoriosSegunRol(trx: Kysely<DB>, roles: string[], territorios: number[]): Promise<number[]> {
    if (!roles.includes('CANDIDATO')) return territorios;
    const departamento = await this.repo.departamentoId(trx);
    if (departamento === undefined) throw new ReglaNegocioError('No hay departamento cargado');
    return [departamento];
  }

  private validarReglasRoles(roles: string[], territorios: number[]) {
    if (roles.includes('LIDER') && territorios.length) throw new ReglaNegocioError('Los líderes no pueden tener territorios asignados; ven su red');
    if (roles.includes('COORDINADOR') && !territorios.length) throw new ReglaNegocioError('Los coordinadores deben tener al menos un territorio');
    if (roles.includes('DIGITADOR') && !territorios.length) {
      throw new ReglaNegocioError('Los digitadores deben tener al menos un territorio: define a qué líderes pueden atribuir los registros');
    }
  }

  private validarNoPropio(actor: UsuarioSesion, objetivoId: string) {
    if (actor.id === objetivoId) throw new ReglaNegocioError('No puede modificarse a sí mismo');
  }

  private claveTemporal(): string {
    return Array.from({ length: 14 }, () => CARACTERES_TEMPORALES[randomInt(CARACTERES_TEMPORALES.length)]).join('');
  }
}
