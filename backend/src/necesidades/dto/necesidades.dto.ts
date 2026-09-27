import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { CATEGORIAS } from '../categorias.js';

export class ListadoNecesidadesDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  municipioId?: number;

  @IsOptional()
  @IsIn([...CATEGORIAS, 'SIN_CLASIFICAR'])
  categoria?: string;

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
  porPagina = 30;
}

export class CorregirCategoriaDto {
  @IsIn(CATEGORIAS)
  categoria!: string;
}
