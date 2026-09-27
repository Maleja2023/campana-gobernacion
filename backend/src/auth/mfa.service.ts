import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Kysely } from 'kysely';
import { randomInt } from 'node:crypto';
import * as OTPAuth from 'otpauth';
import * as QRCode from 'qrcode';
import { CifradoService } from '../cifrado/cifrado.service.js';
import { AuditoriaRepositorio } from '../comun/auditoria/auditoria.repositorio.js';
import { NoAutorizadoError, ReglaNegocioError } from '../comun/errores/errores-dominio.js';
import { DatabaseService } from '../database/database.service.js';
import type { DB } from '../database/db.types.js';
import { AuthRepositorio } from './auth.repositorio.js';
import { CARACTERES_SIN_CONFUSION, hashearClave, verificarClave } from './claves.js';
import { DURACION_ACCESO } from './cookies.js';
import { MfaRepositorio, type CodigoRecuperacion, type FactorMfa } from './mfa.repositorio.js';
import type { UsuarioSesion } from './auth.types.js';

const EMISOR = 'Campaña Gobernación';
const VENTANA_TOTP = 1;
const CANTIDAD_CODIGOS = 10;

@Injectable()
export class MfaService {
  constructor(
    private readonly database: DatabaseService,
    private readonly cifrado: CifradoService,
    private readonly repo: MfaRepositorio,
    private readonly authRepo: AuthRepositorio,
    private readonly auditoria: AuditoriaRepositorio,
    private readonly jwt: JwtService,
  ) {}

  /** Genera un secreto nuevo, lo guarda cifrado (sin confirmar) y devuelve el QR para escanear. */
  async configurar(usuario: UsuarioSesion): Promise<{ otpauthUri: string; qr: string }> {
    const secreto = new OTPAuth.Secret({ size: 20 });
    const totp = new OTPAuth.TOTP({ issuer: EMISOR, label: usuario.login, secret: secreto });
    const otpauthUri = totp.toString();
    const qr = await QRCode.toDataURL(otpauthUri);

    await this.database.comoUsuario(usuario.id, async (trx) => {
      await this.repo.borrarFactoresSinConfirmar(trx, usuario.id);
      await this.repo.crearFactor(trx, usuario.id, this.cifrado.cifrar(secreto.base32));
    });

    return { otpauthUri, qr };
  }

  /** Confirma el factor pendiente, activa el doble factor y entrega los códigos de recuperación (una sola vez). */
  async confirmar(usuario: UsuarioSesion, codigo: string, ip: string | null): Promise<{ codigosRecuperacion: string[] }> {
    return this.database.comoUsuario(usuario.id, async (trx) => {
      const factor = await this.repo.factorSinConfirmar(trx, usuario.id);
      if (!factor) throw new ReglaNegocioError('No hay una configuración de doble factor pendiente. Empiece de nuevo.');

      const paso = this.validarTotp(factor, codigo);
      if (paso === null) throw new ReglaNegocioError('Código incorrecto');

      await this.repo.confirmarFactor(trx, factor.id, paso);
      const codigosRecuperacion = await this.reemplazarCodigosRecuperacion(trx, usuario.id);

      await this.authRepo.marcarMfaVerificado(trx, usuario.sesionId);
      await this.auditoria.registrarSeguridad(trx, usuario.id, 'MFA_ACTIVADO', ip);

      return { codigosRecuperacion };
    });
  }

  /** Verifica el TOTP de una sesión ya iniciada; si acierta, renueva el token de acceso. */
  async verificar(usuario: UsuarioSesion, codigo: string, ip: string | null): Promise<{ accessToken: string }> {
    return this.database.comoUsuario(usuario.id, async (trx) => {
      const factor = await this.repo.factorConfirmado(trx, usuario.id);
      if (!factor) throw new ReglaNegocioError('No tiene un doble factor configurado');

      const paso = this.validarTotp(factor, codigo);
      if (paso === null) {
        await this.auditoria.registrarSeguridad(trx, usuario.id, 'MFA_FALLIDO', ip);
        throw new NoAutorizadoError('Código incorrecto');
      }

      await this.repo.actualizarUltimoPaso(trx, factor.id, paso);
      await this.authRepo.marcarMfaVerificado(trx, usuario.sesionId);

      const accessToken = await this.jwt.signAsync(
        { sub: usuario.id, sid: usuario.sesionId, login: usuario.login },
        { expiresIn: DURACION_ACCESO },
      );
      return { accessToken };
    });
  }

  /** Usa un código de recuperación de un solo uso cuando no se tiene el celular a mano. */
  async recuperacion(usuario: UsuarioSesion, codigoIngresado: string, ip: string | null): Promise<{ mensaje: string }> {
    const codigo = codigoIngresado.trim().toUpperCase();
    return this.database.comoUsuario(usuario.id, async (trx) => {
      const candidatos = await this.repo.codigosNoUsados(trx, usuario.id);
      const acertado = await this.buscarCodigoValido(candidatos, codigo);
      if (!acertado) throw new NoAutorizadoError('Código incorrecto');

      await this.repo.marcarCodigoUsado(trx, acertado.id);
      await this.authRepo.marcarMfaVerificado(trx, usuario.sesionId);
      await this.auditoria.registrarSeguridad(trx, usuario.id, 'CODIGO_RECUPERACION_USADO', ip);
      return { mensaje: 'Código de recuperación aceptado' };
    });
  }

  /** Con un TOTP válido, invalida los códigos de recuperación anteriores y genera 10 nuevos. */
  async regenerarCodigos(usuario: UsuarioSesion, codigo: string): Promise<{ codigosRecuperacion: string[] }> {
    return this.database.comoUsuario(usuario.id, async (trx) => {
      const factor = await this.repo.factorConfirmado(trx, usuario.id);
      if (!factor) throw new ReglaNegocioError('No tiene un doble factor configurado');

      const paso = this.validarTotp(factor, codigo);
      if (paso === null) throw new ReglaNegocioError('Código incorrecto');
      await this.repo.actualizarUltimoPaso(trx, factor.id, paso);

      const codigosRecuperacion = await this.reemplazarCodigosRecuperacion(trx, usuario.id);
      return { codigosRecuperacion };
    });
  }

  private async reemplazarCodigosRecuperacion(trx: Kysely<DB>, usuarioId: string): Promise<string[]> {
    const codigos = Array.from({ length: CANTIDAD_CODIGOS }, () => this.generarCodigoRecuperacion());
    const hashes = await Promise.all(codigos.map((codigo) => hashearClave(codigo)));
    await this.repo.borrarCodigosRecuperacion(trx, usuarioId);
    await this.repo.crearCodigosRecuperacion(trx, usuarioId, hashes);
    return codigos;
  }

  private async buscarCodigoValido(candidatos: CodigoRecuperacion[], codigo: string): Promise<CodigoRecuperacion | undefined> {
    for (const candidato of candidatos) {
      if (await verificarClave(candidato.codigo_hash, codigo)) return candidato;
    }
    return undefined;
  }

  /** Ventana de ±1 paso; rechaza un paso ya usado (evita reutilizar el mismo código). */
  private validarTotp(factor: FactorMfa, codigo: string): number | null {
    const secretoBase32 = this.cifrado.descifrar(factor.secreto_cifrado);
    const totp = new OTPAuth.TOTP({ issuer: EMISOR, secret: OTPAuth.Secret.fromBase32(secretoBase32) });
    const delta = totp.validate({ token: codigo, window: VENTANA_TOTP });
    if (delta === null) return null;
    const paso = totp.counter({}) + delta;
    if (factor.ultimo_paso !== null && paso <= factor.ultimo_paso) return null;
    return paso;
  }

  private generarCodigoRecuperacion(): string {
    const parte = () =>
      Array.from({ length: 4 }, () => CARACTERES_SIN_CONFUSION[randomInt(CARACTERES_SIN_CONFUSION.length)]).join('');
    return `${parte()}-${parte()}`;
  }
}
