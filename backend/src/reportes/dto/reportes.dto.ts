import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';

const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;

export class ReporteQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  municipioId?: number;

  @IsOptional()
  @IsUUID()
  miembroId?: string;

  @IsOptional()
  @IsDateString()
  @Matches(FECHA_ISO)
  desde?: string;

  @IsOptional()
  @IsDateString()
  @Matches(FECHA_ISO)
  hasta?: string;
}

export const REPORTES = ['MUNICIPIOS', 'LIDERES', 'PUESTOS', 'PROYECCION'] as const;
export type TipoReporte = (typeof REPORTES)[number];

export class ExportarReporteDto extends ReporteQueryDto {
  @IsIn(REPORTES)
  reporte!: TipoReporte;

  // Motivo auditado en auditoria.exportaciones.
  @IsString()
  @Length(5, 500)
  motivo!: string;
}

export class BitacoraQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limite = 100;
}
