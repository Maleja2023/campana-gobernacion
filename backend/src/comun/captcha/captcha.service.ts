import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ReglaNegocioError } from '../errores/errores-dominio.js';

const URL_VERIFICACION = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TIEMPO_MAXIMO_MS = 5_000;
export const MENSAJE_CAPTCHA = 'No pudimos verificar que no eres un robot. Recarga la página e inténtalo de nuevo.';

/**
 * Verificación de Cloudflare Turnstile para el registro público.
 * Sin TURNSTILE_SECRETO (desarrollo local) no se verifica nada; en producción
 * la API no arranca sin él (ver variables-entorno.ts). Si Cloudflare no
 * responde, se rechaza el registro: nunca se deja pasar sin verificar.
 */
@Injectable()
export class CaptchaService {
  private readonly logger = new Logger(CaptchaService.name);
  private readonly secreto: string | undefined;
  /** Clave pública para el widget del formulario (null si el captcha no está activo). */
  readonly siteKey: string | null;

  constructor(config: ConfigService) {
    this.secreto = config.get<string>('TURNSTILE_SECRETO') || undefined;
    this.siteKey = this.secreto ? (config.get<string>('TURNSTILE_SITEKEY') ?? null) : null;
    if (!this.secreto) this.logger.warn('TURNSTILE_SECRETO no está configurado: el registro público no exige captcha');
  }

  get activo(): boolean {
    return this.secreto !== undefined;
  }

  async verificar(token: string | undefined, ip: string | null): Promise<void> {
    if (!this.secreto) return;
    if (!token) throw new ReglaNegocioError(MENSAJE_CAPTCHA);

    const cuerpo = new URLSearchParams({ secret: this.secreto, response: token });
    if (ip) cuerpo.set('remoteip', ip);
    let exito = false;
    try {
      const respuesta = await fetch(URL_VERIFICACION, {
        method: 'POST',
        body: cuerpo,
        signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS),
      });
      const datos = (await respuesta.json()) as { success?: boolean; 'error-codes'?: string[] };
      exito = datos.success === true;
      if (!exito) this.logger.warn(`Captcha rechazado: ${(datos['error-codes'] ?? []).join(', ') || 'sin detalle'}`);
    } catch (error) {
      this.logger.error(`No fue posible verificar el captcha con Cloudflare: ${(error as Error).name}`);
    }
    if (!exito) throw new ReglaNegocioError(MENSAJE_CAPTCHA);
  }
}
