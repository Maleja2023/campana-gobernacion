import { Transform, Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Length,
  Matches,
  Min,
} from 'class-validator';

export class ListaUsuariosQueryDto {
  @IsOptional()
  @IsString()
  @Length(1, 100)
  texto?: string;

  @IsOptional()
  @Transform(({ value }) => value === 'true' ? true : value === 'false' ? false : value)
  @IsBoolean()
  activo?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pagina = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  porPagina = 20;
}

export class CrearUsuarioDto {
  @IsEmail()
  login!: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsString({ each: true })
  roles!: string[];

  @IsArray()
  @ArrayUnique()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  territorioIds!: number[];

  @IsOptional()
  @IsUUID()
  miembroId?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{5,10}$/)
  documento?: string;

  @IsOptional()
  @IsString()
  @Length(2, 80)
  nombres?: string;

  @IsOptional()
  @IsString()
  @Length(2, 80)
  apellidos?: string;
}

export class ActualizarUsuarioDto {
  @IsOptional()
  @IsBoolean()
  activo?: boolean;

  @IsOptional()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsString({ each: true })
  roles?: string[];

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  territorioIds?: number[];
}

export class CambiarClaveDto {
  @IsString()
  claveActual!: string;

  @IsString()
  @Length(10, 200)
  claveNueva!: string;
}