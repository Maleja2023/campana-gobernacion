import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PERMITIDO_PENDIENTE } from '../../auth/decoradores.js';

/**
 * Mientras el estado de la sesión no sea LISTO (falta cambiar la clave
 * temporal o completar el doble factor), solo deja pasar las rutas marcadas
 * con `@PermitidoPendiente()`. Corre después de `AutenticacionGuard`, que es
 * quien calcula `req.usuario.estado`; en rutas `@Publico()` no hay
 * `req.usuario` y esta verificación no aplica.
 */
@Injectable()
export class EstadoSesionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (!req.usuario || req.usuario.estado === 'LISTO') return true;

    const permitido = this.reflector.getAllAndOverride<boolean>(PERMITIDO_PENDIENTE, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (permitido) return true;

    throw new ForbiddenException({
      statusCode: 403,
      estado: req.usuario.estado,
      message: 'Debe completar el proceso de acceso pendiente',
    });
  }
}
