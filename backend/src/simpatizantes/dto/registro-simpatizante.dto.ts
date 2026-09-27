import { Type } from 'class-transformer';
import {
  IsISO8601,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  Matches,
} from 'class-validator';

export class RegistroSimpatizanteDto {
  @IsOptional()
  @IsString()
  @Length(3, 40)
  codigoLink?: string;

  @IsString()
  @Matches(/^\d{5,10}$/)
  documento!: string;

  @IsString()
  @Length(2, 80)
  nombres!: string;

  @IsString()
  @Length(2, 80)
  apellidos!: string;

  @IsOptional()
  @IsString()
  @Matches(/^3\d{9}$/)
  telefono?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  territorioId!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  puestoId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  necesidad?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  categoria?: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsString({ each: true })
  finalidades!: string[];

  @Type(() => Number)
  @IsInt()
  @Min(1)
  politicaVersion!: number;

  @IsBoolean()
  aceptaPolitica!: boolean;

  @IsIn(['FORMULARIO_WEB', 'CHATBOT_WEB'])
  canal!: 'FORMULARIO_WEB' | 'CHATBOT_WEB';

  /** Hora en que se capturó el registro en el dispositivo (registro sin
   * conexión que se envía después). Solo lo acepta el registro asistido. */
  @IsOptional()
  @IsISO8601({ strict: true })
  capturadoEn?: string;

  /** Token de Cloudflare Turnstile. Lo exige el registro público cuando el captcha está activo. */
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  captcha?: string;

  @IsOptional()
  @Type(() => Number)
  @Min(-180)
  @Max(180)
  lon?: number;

  @IsOptional()
  @Type(() => Number)
  @Min(-90)
  @Max(90)
  lat?: number;
}