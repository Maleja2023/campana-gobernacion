import { Body, Controller, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import type { UsuarioSesion } from './auth.types.js';
import { establecerCookieAcceso } from './cookies.js';
import { PermitidoPendiente, UsuarioActual } from './decoradores.js';
import { CodigoRecuperacionDto, CodigoTotpDto } from './dto/mfa.dto.js';
import { MfaService } from './mfa.service.js';

@Controller('auth/mfa')
export class MfaController {
  constructor(
    private readonly mfa: MfaService,
    private readonly config: ConfigService,
  ) {}

  /** POST /api/auth/mfa/configurar  (genera el secreto y el QR para escanear) */
  @PermitidoPendiente()
  @Post('configurar')
  configurar(@UsuarioActual() usuario: UsuarioSesion) {
    return this.mfa.configurar(usuario);
  }

  /** POST /api/auth/mfa/confirmar { codigo }  (activa el doble factor; entrega los códigos de recuperación) */
  @PermitidoPendiente()
  @Post('confirmar')
  confirmar(@UsuarioActual() usuario: UsuarioSesion, @Body() dto: CodigoTotpDto, @Req() req: Request) {
    return this.mfa.confirmar(usuario, dto.codigo, req.ip ?? null);
  }

  /** POST /api/auth/mfa/verificar { codigo }  (para una sesión ya iniciada; renueva el token de acceso) */
  @PermitidoPendiente()
  @Post('verificar')
  async verificar(
    @UsuarioActual() usuario: UsuarioSesion,
    @Body() dto: CodigoTotpDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { accessToken } = await this.mfa.verificar(usuario, dto.codigo, req.ip ?? null);
    establecerCookieAcceso(res, accessToken, { cookieSegura: this.config.get<string>('COOKIE_SEGURA') === 'true' });
    return { estado: 'LISTO' as const };
  }

  /** POST /api/auth/mfa/recuperacion { codigo }  (código de recuperación de un solo uso) */
  @PermitidoPendiente()
  @Post('recuperacion')
  recuperacion(@UsuarioActual() usuario: UsuarioSesion, @Body() dto: CodigoRecuperacionDto, @Req() req: Request) {
    return this.mfa.recuperacion(usuario, dto.codigo, req.ip ?? null);
  }

  /** POST /api/auth/mfa/codigos { codigo }  (regenera los 10 códigos de recuperación) */
  @PermitidoPendiente()
  @Post('codigos')
  regenerarCodigos(@UsuarioActual() usuario: UsuarioSesion, @Body() dto: CodigoTotpDto) {
    return this.mfa.regenerarCodigos(usuario, dto.codigo);
  }
}
