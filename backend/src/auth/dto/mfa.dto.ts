import { IsString, Matches } from 'class-validator';

export class CodigoTotpDto {
  @IsString()
  @Matches(/^\d{6}$/, { message: 'El código debe tener 6 dígitos' })
  codigo!: string;
}

export class CodigoRecuperacionDto {
  @IsString()
  @Matches(/^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/, { message: 'El código de recuperación tiene el formato XXXX-XXXX' })
  codigo!: string;
}
