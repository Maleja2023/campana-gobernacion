import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;

export class RegistrosDiariosQueryDto {
  @IsOptional()
  @IsDateString()
  @Matches(FECHA_ISO)
  desde?: string;

  @IsOptional()
  @IsDateString()
  @Matches(FECHA_ISO)
  hasta?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  municipioId?: number;
}

export class RankingQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limite = 10;
}

export class MunicipioQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  municipioId?: number;
}