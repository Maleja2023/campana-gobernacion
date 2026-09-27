import { Transform } from 'class-transformer';
import { IsIn, IsString, Length } from 'class-validator';

export class ResolverAlertaDto {
  @IsIn(['RESUELTA', 'DESCARTADA'])
  estado!: 'RESUELTA' | 'DESCARTADA';

  // Obligatoria al cerrar: hay que dejar constancia de por qué se resolvió o descartó.
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(3, 500)
  observacion!: string;
}
