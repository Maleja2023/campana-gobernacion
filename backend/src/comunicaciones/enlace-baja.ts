import { timingSafeEqual } from 'node:crypto';
import type { CifradoService } from '../cifrado/cifrado.service.js';
import type { Canal } from './proveedores.service.js';

const CANALES: Canal[] = ['SMS', 'EMAIL', 'TELEGRAM'];
const BYTES_FIRMA = 12;

const firma = (cifrado: CifradoService, personaId: string, canal: Canal) =>
  cifrado.hash(`baja:${personaId}:${canal}`).subarray(0, BYTES_FIRMA);

/**
 * Enlace de baja de cada mensaje: identifica a la persona y el canal, firmado
 * con la llave del servidor para que nadie pueda dar de baja a otro.
 * 16 bytes de la persona + 1 del canal + 12 de firma = 39 caracteres.
 */
export function crearTokenBaja(cifrado: CifradoService, personaId: string, canal: Canal): string {
  const id = Buffer.from(personaId.replace(/-/g, ''), 'hex');
  return Buffer.concat([id, Buffer.from([CANALES.indexOf(canal)]), firma(cifrado, personaId, canal)]).toString('base64url');
}

export function leerTokenBaja(cifrado: CifradoService, token: string): { personaId: string; canal: Canal } | null {
  if (!/^[\w-]{30,60}$/.test(token)) return null;
  const b = Buffer.from(token, 'base64url');
  if (b.length !== 16 + 1 + BYTES_FIRMA) return null;
  const canal = CANALES[b[16]];
  if (!canal) return null;
  const hex = b.subarray(0, 16).toString('hex');
  const personaId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  const esperada = firma(cifrado, personaId, canal);
  return timingSafeEqual(esperada, b.subarray(17)) ? { personaId, canal } : null;
}
