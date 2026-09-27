import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { UsuarioSesion } from './auth.types.js';

export const ES_PUBLICO = 'es_publico';
export const PERMISOS_REQUERIDOS = 'permisos_requeridos';
export const PERMITIDO_PENDIENTE = 'permitido_pendiente';

/** La ruta no exige iniciar sesión. Úselo solo para lo verdaderamente público. */
export const Publico = () => SetMetadata(ES_PUBLICO, true);

/** El usuario debe tener TODOS los permisos indicados (tabla acceso.permisos). */
export const RequierePermiso = (...permisos: string[]) => SetMetadata(PERMISOS_REQUERIDOS, permisos);

/**
 * La ruta se puede usar aunque el estado de la sesión no sea LISTO (cambio de
 * clave o doble factor pendientes). Úselo solo en /auth/* y /auth/mfa/*.
 */
export const PermitidoPendiente = () => SetMetadata(PERMITIDO_PENDIENTE, true);

/** Inyecta el usuario autenticado en el parámetro del controlador. */
export const UsuarioActual = createParamDecorator(
  (_dato: unknown, ctx: ExecutionContext): UsuarioSesion => {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (!req.usuario) {
      throw new Error('UsuarioActual usado en una ruta pública');
    }
    return req.usuario;
  },
);
