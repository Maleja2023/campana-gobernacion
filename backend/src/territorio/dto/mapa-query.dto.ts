import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsUUID, Matches, Min } from 'class-validator';

const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Filtros comunes del mapa: la red de un líder o coordinador y un rango de fechas de captura. */
export class FiltrosMapaDto {
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

export class MapaQueryDto extends FiltrosMapaDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  padre?: number;
}

export class MapaMunicipioQueryDto extends FiltrosMapaDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  municipioId?: number;
}

export const CATEGORIAS_NECESIDAD = ['VIAS', 'AGUA', 'SALUD', 'EDUCACION', 'EMPLEO', 'SEGURIDAD', 'VIVIENDA', 'AGRO', 'CONECTIVIDAD', 'AMBIENTE', 'OTRA'];

export class NecesidadesMapaQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  padre?: number;

  @IsOptional()
  @IsIn(CATEGORIAS_NECESIDAD)
  categoria?: string;
}
