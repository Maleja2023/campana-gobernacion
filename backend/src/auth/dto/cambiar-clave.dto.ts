import { IsString, Length } from 'class-validator';

export class CambiarClaveDto {
  @IsString()
  claveActual!: string;

  @IsString()
  @Length(10, 200)
  claveNueva!: string;
}