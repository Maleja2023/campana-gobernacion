import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Kysely } from 'kysely';
import { createHash, randomBytes } from 'node:crypto';
import { AuditoriaRepositorio } from '../comun/auditoria/auditoria.repositorio.js';
import { NoEncontradoError, ReglaNegocioError, NoAutorizadoError } from '../comun/errores/errores-dominio.js';
import { DatabaseService } from '../database/database.service.js';
import type { DB } from '../database/db.types.js';
import { AuthRepositorio } from './auth.repositorio.js';
import { DURACION_ACCESO } from './cookies.js';
import { hashearClave, validarFortaleza, verificarClave } from './claves.js';
import { calcularEstadoSesion, type EstadoSesion } from './estado-sesion.js';
import type { TokenPayload, UsuarioSesion } from './auth.types.js';

const CREDENCIALES_INVALIDAS = 'Usuario o contraseña incorrectos';
const SESION_INVALIDA = 'Sesión inválida o vencida';
const RENOVACION_HORAS_DEFECTO = 12;

export interface ResultadoSesion {
  estado: EstadoSesion;
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService implements OnModuleInit {
  /** Hash de relleno: se verifica contra él cuando el usuario no existe, para
   *  que la respuesta tarde lo mismo y no revele qué usuarios existen. */
  private hashRelleno = '';

  constructor(
    private readonly database: DatabaseService,
    private readonly repo: AuthRepositorio,
    private readonly auditoria: AuditoriaRepositorio,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    this.hashRelleno = await hashearClave('relleno-no-es-una-clave-real');
  }

  async iniciarSesion(login: string, clave: string, ip: string | null, userAgent: string | null): Promise<ResultadoSesion> {
    const db = this.database.db;
    const loginNormalizado = login.trim().toLowerCase();
    const usuario = await this.repo.buscarPorLogin(db, loginNormalizado);

    // Antes de gastar tiempo verificando la clave: si la cuenta acumula
    // demasiados fallos recientes (login o MFA), se rechaza con el mismo
    // mensaje genérico sin siquiera mirar la contraseña.
    if (usuario) {
      const { intentos, minutos } = await this.repo.obtenerParametrosBloqueo(db);
      const fallosRecientes = await this.repo.intentosFallidosRecientes(db, usuario.id, minutos);
      if (fallosRecientes >= intentos) {
        await this.repo.registrarAcceso(db, usuario.id, false, ip);
        throw new NoAutorizadoError(CREDENCIALES_INVALIDAS);
      }
    }

    const claveCorrecta = await verificarClave(usuario?.password_hash ?? this.hashRelleno, clave);

    if (!usuario || !usuario.activo || !claveCorrecta) {
      if (usuario) {
        await this.repo.registrarAcceso(db, usuario.id, false, ip);
      }
      throw new NoAutorizadoError(CREDENCIALES_INVALIDAS);
    }

    const { token: refreshToken, hash: refreshHash } = this.generarTokenRenovacion();
    const sesion = await this.repo.crearSesion(db, {
      usuarioId: usuario.id,
      ip,
      userAgent: userAgent?.slice(0, 300) ?? null,
      renovacionHash: refreshHash,
      renovacionExpiraEn: this.expiracionRenovacion(),
    });
    await this.repo.registrarAcceso(db, usuario.id, true, ip);

    const accessToken = await this.firmarAcceso({ sub: usuario.id, sid: sesion.id, login: usuario.login });
    const estado = await this.estadoDeSesion(db, usuario.id, sesion.id);
    return { estado, accessToken, refreshToken };
  }

  /**
   * Valida la cookie de renovación y ROTA el token: el hash actual pasa a
   * `renovacion_anterior_hash` y se genera uno nuevo. Si llega un token que
   * ya fue rotado antes (reutilización = posible robo de la cookie), cierra
   * esa sesión y lo registra como incidente de seguridad.
   */
  async renovar(tokenPlano: string | undefined, ip: string | null): Promise<ResultadoSesion> {
    if (!tokenPlano) throw new NoAutorizadoError(SESION_INVALIDA);
    const db = this.database.db;
    const hash = this.hashRenovacion(tokenPlano);

    const vigente = await this.repo.sesionPorRenovacionVigente(db, hash);
    if (!vigente) {
      const reutilizado = await this.repo.sesionPorRenovacionAnterior(db, hash);
      if (reutilizado) {
        await this.repo.cerrarSesion(db, reutilizado.id);
        await this.auditoria.registrarSeguridad(db, reutilizado.usuario_id, 'RENOVACION_REUTILIZADA', ip);
      }
      throw new NoAutorizadoError(SESION_INVALIDA);
    }

    const { token: nuevoToken, hash: nuevoHash } = this.generarTokenRenovacion();
    await this.repo.rotarRenovacion(db, vigente.id, {
      hashAnterior: hash,
      hashNuevo: nuevoHash,
      expiraEn: this.expiracionRenovacion(),
    });

    const accessToken = await this.firmarAcceso({ sub: vigente.usuario_id, sid: vigente.id, login: vigente.login });
    const estado = await this.estadoDeSesion(db, vigente.usuario_id, vigente.id);
    return { estado, accessToken, refreshToken: nuevoToken };
  }

  async cerrarSesion(usuario: UsuarioSesion): Promise<void> {
    await this.repo.cerrarSesion(this.database.db, usuario.sesionId);
  }

  /** Datos del usuario para el frontend: nombre, roles, permisos, territorios y estado. */
  async perfil(usuario: UsuarioSesion) {
    return this.database.comoUsuario(usuario.id, async (trx) => {
      const datos = await this.repo.perfilBasico(trx, usuario.id);
      if (!datos) throw new NoEncontradoError('Usuario no encontrado');

      const [roles, permisos, territorios] = await Promise.all([
        this.repo.rolesDe(trx, usuario.id),
        this.repo.permisosDe(trx, usuario.id),
        this.repo.territoriosDe(trx, usuario.id),
      ]);

      return {
        id: datos.id,
        login: datos.login,
        nombres: datos.nombres,
        apellidos: datos.apellidos,
        debeCambiarClave: datos.debe_cambiar_clave,
        estado: usuario.estado,
        roles: roles.map((r) => r.rol_codigo),
        permisos,
        territorios,
      };
    });
  }

  async cambiarClave(usuario: UsuarioSesion, claveActual: string, claveNueva: string) {
    const errorFortaleza = validarFortaleza(claveNueva);
    if (errorFortaleza) throw new ReglaNegocioError(errorFortaleza);
    if (claveActual === claveNueva) throw new ReglaNegocioError('La nueva contraseña debe ser diferente');

    return this.database.comoUsuario(usuario.id, async (trx) => {
      const cuenta = await this.repo.obtenerHashClave(trx, usuario.id);
      if (!cuenta || !(await verificarClave(cuenta.password_hash, claveActual))) {
        throw new ReglaNegocioError('La contraseña actual no es correcta');
      }
      await this.repo.actualizarClave(trx, usuario.id, await hashearClave(claveNueva));
      await this.repo.cerrarOtrasSesiones(trx, usuario.id, usuario.sesionId);
      return { mensaje: 'Contraseña actualizada' };
    });
  }

  private firmarAcceso(payload: TokenPayload): Promise<string> {
    return this.jwt.signAsync(payload, { expiresIn: DURACION_ACCESO });
  }

  private async estadoDeSesion(db: Kysely<DB>, usuarioId: string, sesionId: string): Promise<EstadoSesion> {
    const fila = await this.repo.estadoDeSesion(db, sesionId, usuarioId);
    if (!fila) throw new NoAutorizadoError(SESION_INVALIDA);
    return calcularEstadoSesion({
      debeCambiarClave: fila.debe_cambiar_clave,
      requiereMfa: fila.requiere_mfa,
      tieneFactorConfirmado: fila.tiene_factor,
      mfaVerificado: fila.mfa_verificado,
    });
  }

  private generarTokenRenovacion(): { token: string; hash: Buffer } {
    const token = randomBytes(32).toString('base64url');
    return { token, hash: this.hashRenovacion(token) };
  }

  private hashRenovacion(token: string): Buffer {
    return createHash('sha256').update(token, 'utf8').digest();
  }

  private expiracionRenovacion(): Date {
    const horas = this.config.get<number>('RENOVACION_HORAS') ?? RENOVACION_HORAS_DEFECTO;
    return new Date(Date.now() + horas * 60 * 60 * 1000);
  }
}
