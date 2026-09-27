import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthService, type ResultadoSesion } from './auth.service.js';
import type { UsuarioSesion } from './auth.types.js';
import { borrarCookiesSesion, COOKIE_RENOVACION, establecerCookieAcceso, establecerCookieRenovacion } from './cookies.js';
import { PermitidoPendiente, Publico, UsuarioActual } from './decoradores.js';
import { LoginDto } from './dto/login.dto.js';
import { CambiarClaveDto } from './dto/cambiar-clave.dto.js';

const RENOVACION_HORAS_DEFECTO = 12;

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  /** POST /api/auth/login  { "login": "...", "clave": "..." }
   *  Máximo 5 intentos por minuto por IP (frena ataques de fuerza bruta). */
  @Publico()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const resultado = await this.auth.iniciarSesion(dto.login, dto.clave, req.ip ?? null, req.headers['user-agent'] ?? null);
    this.establecerCookiesSesion(res, resultado);
    return { estado: resultado.estado };
  }

  /** POST /api/auth/renovar  (usa la cookie de renovación; el token de acceso puede haber expirado) */
  @Publico()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('renovar')
  @HttpCode(200)
  async renovar(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const resultado = await this.auth.renovar(req.cookies?.[COOKIE_RENOVACION], req.ip ?? null);
    this.establecerCookiesSesion(res, resultado);
    return { estado: resultado.estado };
  }

  /** POST /api/auth/salir  (cierra la sesión y borra las cookies) */
  @PermitidoPendiente()
  @Post('salir')
  @HttpCode(204)
  async salir(@UsuarioActual() usuario: UsuarioSesion, @Res({ passthrough: true }) res: Response) {
    await this.auth.cerrarSesion(usuario);
    borrarCookiesSesion(res, { cookieSegura: this.cookieSegura() });
  }

  /** GET /api/auth/yo  (quién soy, mis roles, permisos, territorios y el estado de acceso) */
  @PermitidoPendiente()
  @Get('yo')
  yo(@UsuarioActual() usuario: UsuarioSesion) {
    return this.auth.perfil(usuario);
  }

  @PermitidoPendiente()
  @Post('cambiar-clave')
  cambiarClave(@UsuarioActual() usuario: UsuarioSesion, @Body() dto: CambiarClaveDto) {
    return this.auth.cambiarClave(usuario, dto.claveActual, dto.claveNueva);
  }

  private establecerCookiesSesion(res: Response, resultado: ResultadoSesion): void {
    const cookieSegura = this.cookieSegura();
    establecerCookieAcceso(res, resultado.accessToken, { cookieSegura });
    establecerCookieRenovacion(res, resultado.refreshToken, {
      cookieSegura,
      horas: this.config.get<number>('RENOVACION_HORAS') ?? RENOVACION_HORAS_DEFECTO,
    });
  }

  private cookieSegura(): boolean {
    return this.config.get<string>('COOKIE_SEGURA') === 'true';
  }
}
