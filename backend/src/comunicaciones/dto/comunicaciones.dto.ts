import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Length, Matches, Min } from 'class-validator';

export class AvisoEquipoDto {
  @IsString()
  @Length(3, 160)
  titulo!: string;

  @IsString()
  @Length(3, 2000)
  cuerpo!: string;

  /** Vacío = toda la red. */
  @IsOptional()
  @IsArray()
  @IsIn(['COORDINADOR', 'LIDER', 'SUBLIDER'], { each: true })
  cargos?: string[];
}

export class LeerNotificacionesDto {
  /** Vacío = todas. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  ids?: string[];
}

export class PlantillaDto {
  @IsString()
  @Length(3, 120)
  nombre!: string;

  @IsIn(['SMS', 'EMAIL', 'TELEGRAM'])
  canal!: 'SMS' | 'EMAIL' | 'TELEGRAM';

  @IsOptional()
  @IsString()
  @Length(3, 160)
  asunto?: string;

  @IsString()
  @Length(5, 4000)
  contenido!: string;
}

export class EditarPlantillaDto {
  @IsOptional()
  @IsString()
  @Length(3, 160)
  asunto?: string;

  @IsString()
  @Length(5, 4000)
  contenido!: string;
}

export class EnvioDto {
  @IsUUID()
  plantillaId!: string;

  @IsArray()
  @ArrayMaxSize(50)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  territorioIds: number[] = [];

  @IsOptional()
  @IsISO8601({ strict: true })
  programadoPara?: string;
}

export class EstadoEnvioDto {
  @IsIn(['PROGRAMADO', 'BORRADOR', 'CANCELADO'])
  estado!: string;
}

export class TokenBajaDto {
  @IsString()
  @Matches(/^[\w-]{30,60}$/)
  token!: string;
}
