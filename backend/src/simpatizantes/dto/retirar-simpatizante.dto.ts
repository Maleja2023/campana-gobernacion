import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';

/** El motivo del retiro es obligatorio y queda guardado en la fila del simpatizante. */
export class RetirarSimpatizanteDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(5, 500)
  motivo!: string;
}
