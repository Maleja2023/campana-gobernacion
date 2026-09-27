import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type Canal = 'SMS' | 'EMAIL' | 'TELEGRAM';

/** Error de un envío puntual: se marca ese destinatario como FALLIDO y se sigue. */
export class EnvioFallidoError extends Error {}

const TIEMPO_MAXIMO_MS = 15_000;

/**
 * Proveedores de mensajería. Cada canal es opcional y se configura en el .env:
 * - SMS: Twilio (SMS_PROVEEDOR=twilio).
 * - Correo: Resend (EMAIL_PROVEEDOR=resend).
 * - Telegram: un bot publica en el canal de la campaña.
 * "consola" registra el envío sin datos personales (solo desarrollo).
 */
@Injectable()
export class ProveedoresService {
  private readonly log = new Logger('Mensajeria');

  constructor(private readonly config: ConfigService) {}

  disponibles(): Record<Canal, boolean> {
    return {
      SMS: Boolean(this.config.get('SMS_PROVEEDOR')),
      EMAIL: Boolean(this.config.get('EMAIL_PROVEEDOR')),
      TELEGRAM: Boolean(this.config.get('TELEGRAM_BOT_TOKEN')),
    };
  }

  private async post(url: string, init: RequestInit, servicio: string) {
    let respuesta: Response;
    try {
      respuesta = await fetch(url, { ...init, method: 'POST', signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS) });
    } catch (causa) {
      throw new EnvioFallidoError(`${servicio} no respondió (${causa instanceof Error ? causa.name : 'error de red'})`);
    }
    if (!respuesta.ok) {
      const cuerpo = (await respuesta.text().catch(() => '')).slice(0, 200);
      throw new EnvioFallidoError(`${servicio} respondió ${respuesta.status} ${cuerpo}`);
    }
  }

  /** Celular colombiano de 10 dígitos (3xx...). */
  async sms(celular: string, texto: string): Promise<void> {
    if (!/^3\d{9}$/.test(celular)) throw new EnvioFallidoError('Celular no válido');
    const proveedor = this.config.get<string>('SMS_PROVEEDOR');
    if (proveedor === 'consola') {
      this.log.log(`SMS a ***${celular.slice(-4)} (${texto.length} caracteres)`);
      return;
    }
    if (proveedor !== 'twilio') throw new EnvioFallidoError('SMS no configurado');
    const sid = this.config.getOrThrow<string>('TWILIO_CUENTA_SID');
    const remitente = this.config.getOrThrow<string>('SMS_REMITENTE');
    const cuerpo = new URLSearchParams({ To: `+57${celular}`, Body: texto });
    cuerpo.set(remitente.startsWith('MG') ? 'MessagingServiceSid' : 'From', remitente);
    await this.post(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        headers: {
          Authorization: `Basic ${Buffer.from(`${sid}:${this.config.getOrThrow<string>('TWILIO_TOKEN')}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: cuerpo,
      },
      'Twilio',
    );
  }

  async correo(destino: string, asunto: string, texto: string, enlaceBaja: string): Promise<void> {
    const proveedor = this.config.get<string>('EMAIL_PROVEEDOR');
    if (proveedor === 'consola') {
      this.log.log(`Correo a ***@${destino.split('@')[1] ?? '?'}: "${asunto}"`);
      return;
    }
    if (proveedor !== 'resend') throw new EnvioFallidoError('Correo no configurado');
    await this.post(
      'https://api.resend.com/emails',
      {
        headers: { Authorization: `Bearer ${this.config.getOrThrow<string>('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: this.config.getOrThrow<string>('EMAIL_REMITENTE'),
          to: [destino],
          subject: asunto,
          text: texto,
          // Botón "cancelar suscripción" de Gmail y Outlook.
          headers: { 'List-Unsubscribe': `<${enlaceBaja}>` },
        }),
      },
      'Resend',
    );
  }

  /** Publica en el canal de Telegram de la campaña. */
  async telegram(texto: string): Promise<void> {
    const token = this.config.get<string>('TELEGRAM_BOT_TOKEN');
    if (!token) throw new EnvioFallidoError('Telegram no configurado');
    await this.post(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: this.config.getOrThrow<string>('TELEGRAM_CANAL'), text: texto, disable_web_page_preview: true }),
      },
      'Telegram',
    );
  }
}
