import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

const METODOS_PROTEGIDOS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
const CABECERA_ESPERADA = 'campana';

/**
 * Protección CSRF: la sesión vive en cookies (el navegador las manda solas),
 * así que un formulario o <img> de otro sitio podría disparar una petición
 * con la sesión del usuario sin que él se entere. Dos verificaciones baratas
 * que un sitio ajeno no puede reproducir con una petición "simple":
 *
 * 1. La cabecera `X-Requested-With: campana` — un <form> normal no puede
 *    fijar cabeceras personalizadas; solo JavaScript del propio frontend sí.
 * 2. Si el navegador manda `Origin`, debe estar en CORS_ORIGENES.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (!METODOS_PROTEGIDOS.has(req.method.toUpperCase())) return true;

    if (req.headers['x-requested-with'] !== CABECERA_ESPERADA) {
      throw new ForbiddenException('Falta la cabecera de protección contra CSRF');
    }

    const origen = req.headers.origin;
    if (origen) {
      const permitidos = this.config
        .getOrThrow<string>('CORS_ORIGENES')
        .split(',')
        .map((o) => o.trim());
      if (!permitidos.includes(origen)) {
        throw new ForbiddenException('Origen no permitido');
      }
    }

    return true;
  }
}
