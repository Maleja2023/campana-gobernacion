import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

const VERSION = 0x01;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

@Injectable()
export class CifradoService {
  private readonly pepper: Buffer;
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    this.pepper = this.leerClave(config, 'PEPPER_HMAC', false);
    this.key = this.leerClave(config, 'LLAVE_CIFRADO', true);
  }

  hash(valor: string): Buffer {
    return createHmac('sha256', this.pepper).update(valor, 'utf8').digest();
  }

  cifrar(texto: string): Buffer {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const cifrado = Buffer.concat([cipher.update(texto, 'utf8'), cipher.final()]);
    return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), cifrado]);
  }

  descifrar(buffer: Buffer): string {
    if (buffer.length < 1 + IV_BYTES + TAG_BYTES || buffer[0] !== VERSION) {
      throw new Error('Formato de cifrado no soportado');
    }
    const iv = buffer.subarray(1, 1 + IV_BYTES);
    const tag = buffer.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
    const cifrado = buffer.subarray(1 + IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(cifrado), decipher.final()]).toString('utf8');
  }

  normalizarNumero(valor: string): string {
    return valor.replace(/\D/g, '');
  }

  private leerClave(config: ConfigService, nombre: string, exacta: boolean): Buffer {
    const valor = config.get<string>(nombre);
    if (!valor) throw new Error(`${nombre} es obligatoria`);
    const clave = Buffer.from(valor, 'base64');
    if (clave.length < KEY_BYTES || (exacta && clave.length !== KEY_BYTES)) {
      throw new Error(`${nombre} debe contener ${exacta ? 'exactamente' : 'al menos'} 32 bytes en base64`);
    }
    return clave;
  }
}