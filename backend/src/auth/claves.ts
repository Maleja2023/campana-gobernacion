import { hash, verify } from '@node-rs/argon2';

/** Hash Argon2id de una contraseña (parámetros por defecto recomendados). */
export function hashearClave(clave: string): Promise<string> {
  return hash(clave);
}

/** true si la clave coincide. Nunca lanza error (hash inválido = no coincide). */
export async function verificarClave(hashGuardado: string, clave: string): Promise<boolean> {
  try {
    return await verify(hashGuardado, clave);
  } catch {
    return false;
  }
}

/** Reglas mínimas para contraseñas del equipo de campaña. */
export function validarFortaleza(clave: string): string | null {
  if (clave.length < 10) return 'La contraseña debe tener al menos 10 caracteres';
  if (!/[a-zA-Z]/.test(clave) || !/\d/.test(clave)) return 'Debe tener letras y números';
  return null;
}
