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
  if (detalles.length > 0) {
    throw new Error(`Configuración inválida al arrancar la API -> ${detalles.join(' | ')}`);
  }
  return instancia;
}
