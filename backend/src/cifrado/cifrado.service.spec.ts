import { ConfigService } from '@nestjs/config';
import { CifradoService } from './cifrado.service.js';

describe('CifradoService', () => {
  const valorClave = Buffer.alloc(32, 7).toString('base64');
  const servicio = new CifradoService(
    new ConfigService({ PEPPER_HMAC: valorClave, LLAVE_CIFRADO: valorClave }),
  );

  it('cifra y descifra el texto', () => {
    const cifrado = servicio.cifrar('123456789');
    expect(servicio.descifrar(cifrado)).toBe('123456789');
  });

  it('usa un IV distinto en cada cifrado', () => {
    expect(servicio.cifrar('mismo texto')).not.toEqual(servicio.cifrar('mismo texto'));
  });

  it('produce un hash determinístico', () => {
    expect(servicio.hash('123456789')).toEqual(servicio.hash('123456789'));
  });
});