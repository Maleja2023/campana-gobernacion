import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { DatabaseService } from '../database/database.service.js';
import type { TokenPayload } from './auth.types.js';
import { ES_PUBLICO } from './decoradores.js';

/**
 * Guard global: toda ruta exige token válido salvo las marcadas con @Publico().
 * Además del token, verifica en la base que la sesión siga abierta y el
 * usuario activo: así un "cerrar sesión" o una desactivación surten efecto
 * de inmediato, sin esperar a que el token expire.
 */
@Injectable()
export class AutenticacionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly database: DatabaseService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const esPublico = this.reflector.getAllAndOverride<boolean>(ES_PUBLICO, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (esPublico) return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    const [tipo, token] = (req.headers.authorization ?? '').split(' ');
    if (tipo !== 'Bearer' || !token) {
      throw new UnauthorizedException('Debe iniciar sesión');
    }

    let payload: TokenPayload;
    try {
      payload = await this.jwt.verifyAsync<TokenPayload>(token);
    } catch {
      throw new UnauthorizedException('Sesión inválida o vencida');
    }

    const sesion = await this.database.db
      .selectFrom('acceso.sesiones as s')
      .innerJoin('acceso.usuarios as u', 'u.id', 's.usuario_id')
      .select('s.id')
      .where('s.id', '=', payload.sid)
      .where('s.usuario_id', '=', payload.sub)
      .where('s.cerrada_en', 'is', null)
      .where('u.activo', '=', true)
      .executeTakeFirst();

    if (!sesion) {
      throw new UnauthorizedException('La sesión fue cerrada');
    }

    req.usuario = { id: payload.sub, login: payload.login, sesionId: payload.sid };
    return true;
  }
}
