import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Publico, RequierePermiso, UsuarioActual } from '../auth/decoradores.js';
import type { UsuarioSesion } from '../auth/auth.types.js';
import { ComunicacionesService } from './comunicaciones.service.js';
import { AvisoEquipoDto, EditarPlantillaDto, EnvioDto, EstadoEnvioDto, LeerNotificacionesDto, PlantillaDto, TokenBajaDto } from './dto/comunicaciones.dto.js';

/** Notificaciones internas: cada usuario, las suyas. */
@Controller('notificaciones')
export class NotificacionesController {
  constructor(private readonly servicio: ComunicacionesService) {}

  @Get()
  listar(@UsuarioActual() u: UsuarioSesion) {
    return this.servicio.notificaciones(u);
  }

  @Post('leer')
  @HttpCode(200)
  leer(@UsuarioActual() u: UsuarioSesion, @Body() dto: LeerNotificacionesDto) {
    return this.servicio.marcarLeidas(u, dto.ids);
  }

  /** Aviso a la propia red. La base exige MIEMBRO_GESTIONAR o COMUNICACION_ENVIAR. */
  @Post('aviso')
  aviso(@UsuarioActual() u: UsuarioSesion, @Body() dto: AvisoEquipoDto) {
    return this.servicio.avisoEquipo(u, dto);
  }
}

/** Mensajes a votantes (SMS, correo, Telegram), solo con autorización. */
@Controller('comunicaciones')
export class ComunicacionesController {
  constructor(private readonly servicio: ComunicacionesService) {}

  @Get('configuracion')
  @RequierePermiso('COMUNICACION_APROBAR')
  configuracion() {
    return this.servicio.configuracion();
  }

  /** Quien envía y quien aprueba ven las plantillas (la base filtra). */
  @Get('plantillas')
  @RequierePermiso('COMUNICACION_APROBAR')
  plantillas(@UsuarioActual() u: UsuarioSesion) {
    return this.servicio.plantillas(u);
  }

  @Post('plantillas')
  @RequierePermiso('COMUNICACION_ENVIAR')
  crearPlantilla(@UsuarioActual() u: UsuarioSesion, @Body() dto: PlantillaDto) {
    return this.servicio.crearPlantilla(u, dto);
  }

  @Patch('plantillas/:id')
  @RequierePermiso('COMUNICACION_ENVIAR')
  editarPlantilla(@UsuarioActual() u: UsuarioSesion, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: EditarPlantillaDto) {
    return this.servicio.editarPlantilla(u, id, dto.asunto, dto.contenido);
  }

  @Post('plantillas/:id/aprobar')
  @RequierePermiso('COMUNICACION_APROBAR')
  @HttpCode(200)
  aprobar(@UsuarioActual() u: UsuarioSesion, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.servicio.aprobarPlantilla(u, id);
  }

  @Get('envios')
  @RequierePermiso('COMUNICACION_ENVIAR')
  envios(@UsuarioActual() u: UsuarioSesion) {
    return this.servicio.envios(u);
  }

  @Post('envios')
  @RequierePermiso('COMUNICACION_ENVIAR')
  preparar(@UsuarioActual() u: UsuarioSesion, @Body() dto: EnvioDto) {
    return this.servicio.prepararEnvio(u, dto);
  }

  @Post('envios/:id/estado')
  @RequierePermiso('COMUNICACION_ENVIAR')
  @HttpCode(200)
  estado(@UsuarioActual() u: UsuarioSesion, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: EstadoEnvioDto) {
    return this.servicio.cambiarEstadoEnvio(u, id, dto.estado);
  }
}

/** Enlace "no más mensajes" que va en cada SMS y correo. */
@Controller('baja')
export class BajaController {
  constructor(private readonly servicio: ComunicacionesService) {}

  @Get(':token')
  @Publico()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  consultar(@Param() p: TokenBajaDto) {
    return this.servicio.consultarBaja(p.token);
  }

  @Post(':token')
  @Publico()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  confirmar(@Param() p: TokenBajaDto) {
    return this.servicio.darDeBaja(p.token);
  }
}
