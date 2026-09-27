import { Type } from 'class-transformer';
import { ArrayNotEmpty, ArrayUnique, IsArray, IsBoolean, IsDateString, IsInt, IsOptional, IsString, Length, Matches, MaxLength, Min } from 'class-validator';

/** Check-in público por QR. Siempre pide los datos completos. */
export class CheckinDto {
  @IsString()
  @Matches(/^\d{5,10}$/, { message: 'La cédula debe tener entre 5 y 10 dígitos' })
  documento!: string;

  @IsString()
  @Length(2, 80)
  nombres!: string;

  @IsString()
  @Length(2, 80)
  apellidos!: string;

  @IsOptional()
  @IsString()
  @Matches(/^3\d{9}$/, { message: 'El celular debe tener 10 dígitos y empezar por 3' })
  telefono?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  territorioId!: number;

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

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  captcha?: string;
}

/** Asistencia marcada por el equipo con la cédula. */
export class AsistenciaManualDto {
  @IsString()
  @Matches(/^\d{5,10}$/, { message: 'La cédula debe tener entre 5 y 10 dígitos' })
  documento!: string;
}

export class ComparativoDto {
  @IsDateString()
  desde!: string;

  @IsDateString()
  hasta!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  municipioId?: number;
}
