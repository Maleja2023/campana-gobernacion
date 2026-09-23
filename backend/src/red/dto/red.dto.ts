import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsISO8601,
  IsIn,
  IsOptional,
  IsUUID,
  IsString,
  Length,
  Matches,
  Min,
} from 'class-validator';

export class CrearLinkDto {
  @IsOptional()
  @IsDateString()
  expiraEn?: string;
}

export class ActualizarLinkDto {
  @IsBoolean()
  activo!: boolean;
}

export class CrearMiembroDto {
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

  @IsIn(['COORDINADOR', 'LIDER', 'SUBLIDER'])
  cargo!: 'COORDINADOR' | 'LIDER' | 'SUBLIDER';

  @IsUUID()
  superiorId!: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  territorioIds?: number[];
}

export class ActualizarMiembroDto {
  @IsOptional()
  @IsBoolean()
  activo?: boolean;

  @IsOptional()
  @IsUUID()
  superiorId?: string;
}

abstract class CrearMetaBaseDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  cantidad!: number;

  @IsString()
  @IsISO8601({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  fechaInicio!: string;

  @IsString()
  @IsISO8601({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  fechaLimite!: string;
}

export class CrearMetaMiembroDto extends CrearMetaBaseDto {
  @IsUUID()
  miembroId!: string;
}

export class CrearMetaTerritorioDto extends CrearMetaBaseDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  territorioId!: number;
}