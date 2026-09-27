import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Matches, Min } from 'class-validator';

/** Edición parcial: solo se cambian los campos que se envían. */
export class EditarSimpatizanteDto {
  @IsOptional()
  @IsString()
  @Length(2, 80)
  nombres?: string;

  @IsOptional()
  @IsString()
  @Length(2, 80)
  apellidos?: string;

  @IsOptional()
  @IsString()
  @Matches(/^3\d{9}$/)
  telefono?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  territorioId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  puestoId?: number;
}
