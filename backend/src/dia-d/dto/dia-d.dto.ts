import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';

const CORPORACIONES = ['GOBERNACION', 'ASAMBLEA', 'ALCALDIA', 'CONCEJO', 'JAL'];

export class JornadaDto {
  @IsString()
  @Length(3, 120)
  nombre!: string;

  @IsIn(['TERRITORIAL', 'NACIONAL', 'CONSULTA'])
  tipo!: string;

  @IsDateString()
  fecha!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  copiarDe!: number;
}

export class CandidatoDto {
  @IsIn(CORPORACIONES)
  corporacion!: string;

  @IsString()
  @Length(3, 160)
  nombre!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  partido?: string;

  @IsBoolean()
  propio!: boolean;
}

export class CorporacionQueryDto {
  @IsIn(CORPORACIONES)
  corporacion!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  municipioId?: number;
}

export class MunicipioQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  municipioId?: number;
}

export class MesasDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(200)
  cantidad!: number;
}

export class TestigoDto {
  /** null = quitar el testigo de la mesa. */
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  usuarioId!: string | null;
}

/** Llega como multipart: los números vienen como texto. */
export class CargarE14Dto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  mesaId!: number;

  @IsIn(CORPORACIONES)
  corporacion!: string;

  /** JSON {"<opcion_voto_id>": votos} */
  @IsString()
  @Matches(/^\{[\s"\d:,]*\}$/, { message: 'Votos con formato no válido' })
  @MaxLength(2000)
  votos!: string;
}

export class RevisionQueryDto {
  @IsOptional()
  @IsIn(['PENDIENTE', 'VALIDADO', 'CON_INCONSISTENCIAS'])
  estado?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  municipioId?: number;
}

export class RevisarE14Dto {
  @IsIn(['PENDIENTE', 'VALIDADO', 'CON_INCONSISTENCIAS'])
  estado!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  observacion?: string;
}
