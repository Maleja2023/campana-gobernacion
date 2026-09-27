/**
 * Estado de la sesión respecto al proceso de acceso. Mientras no sea LISTO,
 * `EstadoSesionGuard` solo permite las rutas marcadas con `@PermitidoPendiente()`.
 * Prioridad (en este orden): CAMBIAR_CLAVE > MFA_CONFIGURAR > MFA_VERIFICAR > LISTO.
 */
export type EstadoSesion = 'CAMBIAR_CLAVE' | 'MFA_CONFIGURAR' | 'MFA_VERIFICAR' | 'LISTO';

export interface DatosEstadoSesion {
  debeCambiarClave: boolean;
  requiereMfa: boolean;
  tieneFactorConfirmado: boolean;
  mfaVerificado: boolean;
}

export function calcularEstadoSesion(datos: DatosEstadoSesion): EstadoSesion {
  if (datos.debeCambiarClave) return 'CAMBIAR_CLAVE';
  if (datos.requiereMfa && !datos.tieneFactorConfirmado) return 'MFA_CONFIGURAR';
  if (datos.tieneFactorConfirmado && !datos.mfaVerificado) return 'MFA_VERIFICAR';
  return 'LISTO';
}
