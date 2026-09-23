import { Controller, Get, HttpCode, Param, ParseIntPipe, ParseUUIDPipe, Post, Query, Req, Body } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Publico, RequierePermiso, UsuarioActual } from '../auth/decoradores.js';
import type { UsuarioSesion } from '../auth/auth.types.js';
import { RegistroSimpatizanteDto } from './dto/registro-simpatizante.dto.js';
import { SimpatizantesService } from './simpatizantes.service.js';

@Controller()
export class SimpatizantesController {
  constructor(private readonly simpatizantes: SimpatizantesService) {}

  @Get('registro/politica')
  @Publico()
  politica() {
    return this.simpatizantes.politica();
  }

  @Post('registro')
  @Publico()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(201)
  registrar(@Body() dto: RegistroSimpatizanteDto, @Req() req: Request) {
    return this.simpatizantes.autorregistro(dto, req.ip ?? null, req.headers['user-agent'] ?? null);
  }

  @Post('simpatizantes')
  @RequierePermiso('SIMPATIZANTE_CREAR')
  @HttpCode(201)
  crear(@Body() dto: RegistroSimpatizanteDto, @UsuarioActual() usuario: UsuarioSesion, @Req() req: Request) {
    return this.simpatizantes.crear(dto, usuario, req.ip ?? null, req.headers['user-agent'] ?? null);
  }

  @Get('simpatizantes')
  @RequierePermiso('SIMPATIZANTE_VER')
  listar(
    @UsuarioActual() usuario: UsuarioSesion,
    @Query('municipioId', new ParseIntPipe({ optional: true })) municipioId?: number,
    @Query('territorioId', new ParseIntPipe({ optional: true })) territorioId?: number,
    @Query('pagina', new ParseIntPipe({ optional: true })) pagina = 1,
    @Query('porPagina', new ParseIntPipe({ optional: true })) porPagina = 20,
    @Query('estado') estado?: string,
    @Query('texto') texto?: string,
  ) {
    return this.simpatizantes.listar(usuario, {
      municipioId,
      territorioId,
      estado,
      texto: texto?.trim(),
      pagina: Math.max(1, pagina),
      porPagina: Math.min(100, Math.max(1, porPagina)),
    });
  }

  @Get('simpatizantes/:personaId/documento')
  @RequierePermiso('DOCUMENTO_VER')
  documento(@Param('personaId', new ParseUUIDPipe()) personaId: string, @UsuarioActual() usuario: UsuarioSesion) {
    return this.simpatizantes.documento(usuario, personaId);
  }
}