import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Matches, Min } from 'class-validator';

export class EditarSimpatizanteDto {
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

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  territorioId?: number;
}
