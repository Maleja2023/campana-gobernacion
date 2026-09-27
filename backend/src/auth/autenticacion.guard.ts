import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { DatabaseService } from '../database/database.service.js';
import { AuthRepositorio } from './auth.repositorio.js';
import { COOKIE_ACCESO } from './cookies.js';
import { ES_PUBLICO } from './decoradores.js';
import { calcularEstadoSesion } from './estado-sesion.js';
import type { TokenPayload } from './auth.types.js';

/**
 * Guard global: toda ruta exige la cookie `campana_acceso` válida salvo las
 * marcadas con @Publico(). Además del token, verifica en la base que la
 * sesión siga abierta y el usuario activo: así un "cerrar sesión" o una
 * desactivación surten efecto de inmediato, sin esperar a que el token
 * expire. También calcula el estado del proceso de acceso (cambio de clave,
 * doble factor) que usa `EstadoSesionGuard`.
 */
@Injectable()
export class AutenticacionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly database: DatabaseService,
    private readonly repo: AuthRepositorio,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const esPublico = this.reflector.getAllAndOverride<boolean>(ES_PUBLICO, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (esPublico) return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    const token: string | undefined = req.cookies?.[COOKIE_ACCESO];
    if (!token) {
      throw new UnauthorizedException('Debe iniciar sesión');
    }

    let payload: TokenPayload;
    try {
      payload = await this.jwt.verifyAsync<TokenPayload>(token);
    } catch {
      throw new UnauthorizedException('Sesión inválida o vencida');
    }

    const fila = await this.repo.estadoDeSesion(this.database.db, payload.sid, payload.sub);
    if (!fila) {
      throw new UnauthorizedException('La sesión fue cerrada');
    }

    req.usuario = {
      id: payload.sub,
      login: payload.login,
      sesionId: payload.sid,
      estado: calcularEstadoSesion({
        debeCambiarClave: fila.debe_cambiar_clave,
        requiereMfa: fila.requiere_mfa,
        tieneFactorConfirmado: fila.tiene_factor,
        mfaVerificado: fila.mfa_verificado,
      }),
    };
    return true;
  }
}
