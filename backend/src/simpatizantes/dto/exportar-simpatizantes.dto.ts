import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Min } from 'class-validator';

export class ExportarSimpatizantesDto {
  // Motivo auditado: por qué se exportan estos datos (auditoria.exportaciones.motivo).
  @IsString()
  @Length(5, 500)
  motivo!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  municipioId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  territorioId?: number;

  @IsOptional()
  @IsString()
  estado?: string;

  @IsOptional()
  @IsString()
  texto?: string;
}
