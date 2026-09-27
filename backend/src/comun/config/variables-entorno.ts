import { plainToInstance, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsUrl,
  Matches,
  Max,
  Min,
  MinLength,
  registerDecorator,
  validateSync,
  type ValidationOptions,
} from 'class-validator';

/** La clave debe decodificar en base64 a al menos `minBytes` bytes. */
function EsClaveBase64(minBytes: number, validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'esClaveBase64',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(valor: unknown): boolean {
          if (typeof valor !== 'string' || valor.length === 0) return false;
          try {
            return Buffer.from(valor, 'base64').length >= minBytes;
          } catch {
            return false;
          }
        },
        defaultMessage(): string {
          return `${propertyName} debe ser una clave en base64 de al menos ${minBytes} bytes`;
        },
      },
    });
  };
}

/**
 * Todas las variables de entorno que la API necesita para arrancar.
 * `validarVariablesEntorno` se conecta en ConfigModule.forRoot({ validate }):
 * si algo falta o tiene un formato inválido, la app no inicia y el mensaje
 * dice exactamente cuál variable está mal.
 */
export class VariablesEntorno {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT?: number;

  @Matches(/^https?:\/\/\S+(,https?:\/\/\S+)*$/, {
    message: 'CORS_ORIGENES debe ser una o más URL http(s) separadas por coma, sin espacios',
  })
  CORS_ORIGENES!: string;

  @IsUrl({ require_tld: false })
  URL_REGISTRO_BASE!: string;

  @Matches(/^\S+$/, { message: 'DB_HOST es obligatorio' })
  DB_HOST!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  DB_PORT?: number;

  @Matches(/^\S+$/, { message: 'DB_NOMBRE es obligatorio' })
  DB_NOMBRE!: string;

  @Matches(/^(?!postgres$)\S+$/, {
    message: 'DB_USUARIO no puede ser "postgres": ese rol se salta la seguridad por fila',
  })
  DB_USUARIO!: string;

  @MinLength(8, { message: 'DB_CLAVE debe tener al menos 8 caracteres' })
  DB_CLAVE!: string;

  @MinLength(32, { message: 'JWT_SECRETO debe tener al menos 32 caracteres' })
  JWT_SECRETO!: string;

  @IsIn(['true', 'false'], { message: 'COOKIE_SEGURA debe ser "true" o "false" (true en producción, con HTTPS)' })
  COOKIE_SEGURA!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24 * 30)
  RENOVACION_HORAS?: number;

  @EsClaveBase64(32)
  PEPPER_HMAC!: string;

  @EsClaveBase64(32)
  LLAVE_CIFRADO!: string;

  @IsOptional()
  @IsIn(['true', 'false'], { message: 'TRUST_PROXY debe ser "true" o "false"' })
  TRUST_PROXY?: string;

  /** Clave secreta de Cloudflare Turnstile (captcha del registro público).
   * Opcional en desarrollo; obligatoria en producción (COOKIE_SEGURA=true). */
  @IsOptional()
  @Matches(/^\S{10,}$/, { message: 'TURNSTILE_SECRETO no tiene un formato válido' })
  TURNSTILE_SECRETO?: string;

  /** Clave pública de Turnstile (la usa el formulario público). Va junto con TURNSTILE_SECRETO. */
  @IsOptional()
  @Matches(/^\S{10,}$/, { message: 'TURNSTILE_SITEKEY no tiene un formato válido' })
  TURNSTILE_SITEKEY?: string;

  /** Clave de la API de Anthropic (Claude) para clasificar necesidades y
   * generar informes. Opcional: sin ella, las necesidades se clasifican con
   * reglas por palabras clave y no se ofrecen informes con IA. */
  @IsOptional()
  @Matches(/^sk-ant-\S{10,}$/, { message: 'ANTHROPIC_API_KEY no tiene un formato válido (empieza por sk-ant-)' })
  ANTHROPIC_API_KEY?: string;

  /** Modelo de Claude a usar (por defecto claude-opus-5). */
  @IsOptional()
  @Matches(/^claude-[a-z0-9-]+$/, { message: 'IA_MODELO debe ser un modelo de Claude, por ejemplo claude-opus-5' })
  IA_MODELO?: string;

  /** Responsable del tratamiento de datos (Ley 1581): aparece en la página de privacidad. */
  @IsOptional()
  @MinLength(3)
  RESPONSABLE_NOMBRE?: string;

  @IsOptional()
  @Matches(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, { message: 'RESPONSABLE_CORREO debe ser un correo' })
  RESPONSABLE_CORREO?: string;

  @IsOptional()
  @MinLength(7)
  RESPONSABLE_TELEFONO?: string;

  /** Mensajes a votantes. Cada canal es opcional: sin configurar, no se ofrece.
   * "consola" solo escribe en el registro de la API (para pruebas, no en producción). */
  @IsOptional()
  @IsIn(['twilio', 'consola'], { message: 'SMS_PROVEEDOR debe ser "twilio" o "consola"' })
  SMS_PROVEEDOR?: string;

  @IsOptional()
  @Matches(/^AC[0-9a-f]{32}$/, { message: 'TWILIO_CUENTA_SID empieza por AC y tiene 34 caracteres' })
  TWILIO_CUENTA_SID?: string;

  @IsOptional()
  @MinLength(16)
  TWILIO_TOKEN?: string;

  /** Número remitente (+57...) o Messaging Service SID (MG...). */
  @IsOptional()
  @Matches(/^(\+\d{8,15}|MG[0-9a-f]{32})$/, { message: 'SMS_REMITENTE debe ser un número +57... o un Messaging Service SID (MG...)' })
  SMS_REMITENTE?: string;

  @IsOptional()
  @IsIn(['resend', 'consola'], { message: 'EMAIL_PROVEEDOR debe ser "resend" o "consola"' })
  EMAIL_PROVEEDOR?: string;

  @IsOptional()
  @Matches(/^re_\S{10,}$/, { message: 'RESEND_API_KEY empieza por re_' })
  RESEND_API_KEY?: string;

  /** Remitente del correo, por ejemplo: Campaña <noticias@dominio.co> */
  @IsOptional()
  @MinLength(5)
  EMAIL_REMITENTE?: string;

  @IsOptional()
  @Matches(/^\d+:[\w-]{30,}$/, { message: 'TELEGRAM_BOT_TOKEN no tiene el formato 123456:ABC...' })
  TELEGRAM_BOT_TOKEN?: string;

  /** Canal público de la campaña: @nombre_del_canal o su id numérico (-100...). */
  @IsOptional()
  @Matches(/^(@\w{5,}|-100\d+)$/, { message: 'TELEGRAM_CANAL debe ser @nombre_del_canal o -100...' })
  TELEGRAM_CANAL?: string;
}

export function validarVariablesEntorno(config: Record<string, unknown>): VariablesEntorno {
  // Una variable opcional escrita vacía en .env (TURNSTILE_SITEKEY=) cuenta como no configurada.
  const limpia = Object.fromEntries(Object.entries(config).filter(([, valor]) => valor !== ''));
  const instancia = plainToInstance(VariablesEntorno, limpia, { enableImplicitConversion: true });
  const errores = validateSync(instancia, { skipMissingProperties: false });
  const detalles = errores.map((error) => `${error.property}: ${Object.values(error.constraints ?? {}).join('; ')}`);
  if (Boolean(instancia.TURNSTILE_SECRETO) !== Boolean(instancia.TURNSTILE_SITEKEY)) {
    detalles.push('TURNSTILE_SECRETO y TURNSTILE_SITEKEY: se configuran los dos o ninguno');
  }
  if (instancia.COOKIE_SEGURA === 'true' && !instancia.TURNSTILE_SECRETO) {
    detalles.push('TURNSTILE_SECRETO: es obligatorio en producción (COOKIE_SEGURA=true) para proteger el registro público');
  }
  if (instancia.SMS_PROVEEDOR === 'twilio' && !(instancia.TWILIO_CUENTA_SID && instancia.TWILIO_TOKEN && instancia.SMS_REMITENTE)) {
    detalles.push('SMS_PROVEEDOR=twilio: faltan TWILIO_CUENTA_SID, TWILIO_TOKEN o SMS_REMITENTE');
  }
  if (instancia.EMAIL_PROVEEDOR === 'resend' && !(instancia.RESEND_API_KEY && instancia.EMAIL_REMITENTE)) {
    detalles.push('EMAIL_PROVEEDOR=resend: faltan RESEND_API_KEY o EMAIL_REMITENTE');
  }
  if (Boolean(instancia.TELEGRAM_BOT_TOKEN) !== Boolean(instancia.TELEGRAM_CANAL)) {
    detalles.push('TELEGRAM_BOT_TOKEN y TELEGRAM_CANAL: se configuran los dos o ninguno');
  }
  if (instancia.COOKIE_SEGURA === 'true' && (instancia.SMS_PROVEEDOR === 'consola' || instancia.EMAIL_PROVEEDOR === 'consola')) {
    detalles.push('SMS_PROVEEDOR / EMAIL_PROVEEDOR: "consola" no se permite en producción (COOKIE_SEGURA=true)');
  }
  if (detalles.length > 0) {
    throw new Error(`Configuración inválida al arrancar la API -> ${detalles.join(' | ')}`);
  }
  return instancia;
}
