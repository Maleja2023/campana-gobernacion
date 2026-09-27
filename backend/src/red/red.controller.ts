import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { RequierePermiso, UsuarioActual } from '../auth/decoradores.js';
import type { UsuarioSesion } from '../auth/auth.types.js';
import {
  ActualizarLinkDto,
  ActualizarMiembroDto,
  CrearLinkDto,
  CrearMetaMiembroDto,
  CrearMetaTerritorioDto,
  CrearMiembroDto,
  ResolverSolicitudDto,
  SolicitudesQueryDto,
} from './dto/red.dto.js';
import { RedService } from './red.service.js';

@Controller('red')
export class RedController {
  constructor(private readonly red: RedService) {}

  @Get('mis-links')
  misLinks(@UsuarioActual() usuario: UsuarioSesion) {
    return this.red.misLinks(usuario);
  }

  /** GET /api/red/enlace-lideres — enlace para sumar líderes o sublíderes (se crea la primera vez). */
  @Get('enlace-lideres')
  @RequierePermiso('REPORTE_VER')
  enlaceLideres(@UsuarioActual() usuario: UsuarioSesion) {
    return this.red.enlaceLideres(usuario);
  }

  /** GET /api/red/solicitudes?estado=PENDIENTE — quienes pidieron ser líderes por un enlace de líderes. */
  @Get('solicitudes')
  @RequierePermiso('REPORTE_VER')
  solicitudes(@UsuarioActual() usuario: UsuarioSesion, @Query() q: SolicitudesQueryDto) {
    return this.red.solicitudes(usuario, q.estado);
  }

  /** POST /api/red/solicitudes/:id/resolver — aprobar (crea el miembro) o rechazar. */
  @Post('solicitudes/:id/resolver')
  @RequierePermiso('REPORTE_VER')
  @HttpCode(200)
  resolver(@UsuarioActual() usuario: UsuarioSesion, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: ResolverSolicitudDto) {
    return this.red.resolverSolicitud(usuario, id, dto.aprobar, dto.observacion);
  }

  @Post('mis-links')
  @RequierePermiso('SIMPATIZANTE_CREAR')
  crearLink(@UsuarioActual() usuario: UsuarioSesion, @Body() dto: CrearLinkDto) {
    return this.red.crearLink(usuario, dto);
  }

  @Patch('links/:linkId')
  @RequierePermiso('SIMPATIZANTE_CREAR')
  actualizarLink(@Param('linkId', new ParseUUIDPipe()) linkId: string, @UsuarioActual() usuario: UsuarioSesion, @Body() dto: ActualizarLinkDto) {
    return this.red.actualizarLink(usuario, linkId, dto);
  }

  @Get('arbol')
  @RequierePermiso('REPORTE_VER')
  arbol(@UsuarioActual() usuario: UsuarioSesion) {
    return this.red.arbol(usuario);
  }

  @Post('miembros')
  @RequierePermiso('MIEMBRO_GESTIONAR')
  crearMiembro(@UsuarioActual() usuario: UsuarioSesion, @Body() dto: CrearMiembroDto) {
    return this.red.crearMiembro(usuario, dto);
  }

  @Patch('miembros/:miembroId')
  @RequierePermiso('MIEMBRO_GESTIONAR')
  actualizarMiembro(@Param('miembroId', new ParseUUIDPipe()) miembroId: string, @UsuarioActual() usuario: UsuarioSesion, @Body() dto: ActualizarMiembroDto) {
    return this.red.actualizarMiembro(usuario, miembroId, dto);
  }

  @Post('metas/miembro')
  @RequierePermiso('META_GESTIONAR')
  crearMetaMiembro(@UsuarioActual() usuario: UsuarioSesion, @Body() dto: CrearMetaMiembroDto) {
    return this.red.crearMetaMiembro(usuario, dto);
  }

  @Post('metas/territorio')
  @RequierePermiso('META_GESTIONAR')
  crearMetaTerritorio(@UsuarioActual() usuario: UsuarioSesion, @Body() dto: CrearMetaTerritorioDto) {
    return this.red.crearMetaTerritorio(usuario, dto);
  }
}