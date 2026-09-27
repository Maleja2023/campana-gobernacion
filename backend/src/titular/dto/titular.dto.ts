import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, Length, Matches, MaxLength, Min } from 'class-validator';

export const TIPOS_SOLICITUD = ['CONSULTA', 'ACTUALIZACION', 'SUPRESION', 'REVOCATORIA'] as const;

export class RadicarSolicitudDto {
  @IsIn(TIPOS_SOLICITUD)
  tipo!: string;

  @IsString()
  @Matches(/^\d{5,10}$/, { message: 'La cédula debe tener entre 5 y 10 dígitos' })
  documento!: string;

  /** Correo o celular donde se le responde. */
  @IsString()
  @Length(5, 120)
  contacto!: string;

  @IsString()
  @Length(10, 2000)
  descripcion!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  captcha?: string;
}

export class EstadoSolicitudDto {
  @IsString()
  @Matches(/^T-\d{4}-\d{5,}$/i, { message: 'El radicado tiene la forma T-2026-00012' })
  radicado!: string;

  @IsString()
  @Matches(/^\d{5,10}$/)
  documento!: string;
}

export class BajaDto {
  @IsString()
  @Matches(/^\d{5,10}$/)
  documento!: string;

  /** Sin canal: todos (SMS, correo y Telegram). */
  @IsOptional()
  @IsIn(['SMS', 'EMAIL', 'TELEGRAM'])
  canal?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  captcha?: string;
}

export class TramitarDto {
  @IsIn(['EN_TRAMITE', 'RESPONDER', 'RECHAZAR', 'REVOCAR', 'SUPRIMIR'])
  accion!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  respuesta?: string;
}

export class ListadoSolicitudesDto {
  @IsOptional()
  @IsIn(['ABIERTAS', 'RECIBIDA', 'EN_TRAMITE', 'RESPONDIDA', 'RECHAZADA'])
  estado?: string;
}

export class BitacoraDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  usuario?: string;

  @IsOptional()
  @IsIn(['INSERT', 'UPDATE', 'DELETE', 'CONSULTA', 'EXPORTACION', 'LOGIN', 'LOGIN_FALLIDO', 'MFA_ACTIVADO', 'MFA_FALLIDO', 'MFA_RESTABLECIDO', 'CODIGO_RECUPERACION_USADO', 'RENOVACION_REUTILIZADA'])
  accion?: string;

  @IsOptional()
  @Matches(/^[a-z_]{2,60}$/)
  tabla?: string;

  @IsOptional()
  @IsDateString()
  desde?: string;

  @IsOptional()
  @IsDateString()
  hasta?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pagina = 1;
}
