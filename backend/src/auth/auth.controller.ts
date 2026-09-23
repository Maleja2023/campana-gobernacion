import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AuthService } from './auth.service.js';
import type { UsuarioSesion } from './auth.types.js';
import { Publico, UsuarioActual } from './decoradores.js';
import { LoginDto } from './dto/login.dto.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** POST /api/auth/login  { "login": "...", "clave": "..." }
   *  Máximo 5 intentos por minuto por IP (frena ataques de fuerza bruta). */
  @Publico()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.iniciarSesion(dto.login, dto.clave, req.ip ?? null, req.headers['user-agent'] ?? null);
  }

  /** POST /api/auth/salir  (cierra la sesión: el token deja de servir de inmediato) */
  @Post('salir')
  @HttpCode(204)
  salir(@UsuarioActual() usuario: UsuarioSesion) {
    return this.auth.cerrarSesion(usuario);
  }

  /** GET /api/auth/yo  (quién soy, mis roles, permisos y territorios) */
  @Get('yo')
  yo(@UsuarioActual() usuario: UsuarioSesion) {
    return this.auth.perfil(usuario);
  }
}
