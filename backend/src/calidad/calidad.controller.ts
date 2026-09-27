import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import type { UsuarioSesion } from '../auth/auth.types.js';
import { RequierePermiso, UsuarioActual } from '../auth/decoradores.js';
import { CalidadService } from './calidad.service.js';
import { ResolverAlertaDto } from './dto/resolver-alerta.dto.js';

@Controller('calidad')
export class CalidadController {
  constructor(private readonly calidad: CalidadService) {}

  /** GET /api/calidad/alertas            -> alertas abiertas o en revisión
   *  GET /api/calidad/alertas?estado=X   -> alertas en ese estado exacto
   */
  @Get('alertas')
  @RequierePermiso('ALERTA_GESTIONAR')
  listar(@UsuarioActual() usuario: UsuarioSesion, @Query('estado') estado?: string) {
    return this.calidad.listar(usuario, estado);
  }

  @Get('alertas/:id')
  @RequierePermiso('ALERTA_GESTIONAR')
  detalle(@Param('id', new ParseUUIDPipe()) id: string, @UsuarioActual() usuario: UsuarioSesion) {
    return this.calidad.detalle(usuario, id);
  }

  @Patch('alertas/:id')
  @RequierePermiso('ALERTA_GESTIONAR')
  resolver(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: ResolverAlertaDto, @UsuarioActual() usuario: UsuarioSesion) {
    return this.calidad.resolver(usuario, id, dto);
  }
}
