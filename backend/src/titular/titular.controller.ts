import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Publico, RequierePermiso, UsuarioActual } from '../auth/decoradores.js';
import type { UsuarioSesion } from '../auth/auth.types.js';
import { BajaDto, BitacoraDto, EstadoSolicitudDto, ListadoSolicitudesDto, RadicarSolicitudDto, TramitarDto } from './dto/titular.dto.js';
import { TitularService } from './titular.service.js';

/** Canal público del titular de los datos (Ley 1581 de 2012). */
@Controller('titular')
export class TitularController {
  constructor(private readonly titular: TitularService) {}

  /** GET /api/titular/responsable — quién responde por los datos. */
  @Get('responsable')
  @Publico()
  responsable() {
    return this.titular.responsableDatos();
  }

  /** POST /api/titular/solicitudes — consulta, actualización, supresión o revocatoria. */
  @Post('solicitudes')
  @Publico()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @HttpCode(201)
  radicar(@Body() dto: RadicarSolicitudDto, @Req() req: Request) {
    return this.titular.radicar(dto, req.ip ?? null);
  }

  /** POST /api/titular/estado — estado de una solicitud con el radicado y la cédula. */
  @Post('estado')
  @Publico()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  estado(@Body() dto: EstadoSolicitudDto) {
    return this.titular.estado(dto.radicado, dto.documento);
  }

  /** POST /api/titular/baja — no recibir más mensajes (todos los canales o uno). */
  @Post('baja')
  @Publico()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  baja(@Body() dto: BajaDto, @Req() req: Request) {
    return this.titular.baja(dto, req.ip ?? null);
  }
}

/** Trámite de las solicitudes de titulares y bitácora de auditoría. */
@Controller()
export class CumplimientoController {
  constructor(private readonly titular: TitularService) {}

  @Get('cumplimiento/solicitudes')
  @RequierePermiso('SOLICITUD_TITULAR')
  listado(@UsuarioActual() usuario: UsuarioSesion, @Query() q: ListadoSolicitudesDto) {
    return this.titular.listado(usuario, q.estado);
  }

  /** Datos que la campaña tiene del titular (cédula y teléfonos descifrados; queda en la bitácora). */
  @Get('cumplimiento/solicitudes/:id/datos')
  @RequierePermiso('SOLICITUD_TITULAR')
  datos(@UsuarioActual() usuario: UsuarioSesion, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.titular.datos(usuario, id);
  }

  @Post('cumplimiento/solicitudes/:id/tramitar')
  @RequierePermiso('SOLICITUD_TITULAR')
  @HttpCode(200)
  tramitar(@UsuarioActual() usuario: UsuarioSesion, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: TramitarDto) {
    return this.titular.tramitar(usuario, id, dto.accion, dto.respuesta);
  }

  /** GET /api/auditoria/bitacora — quién consultó, editó, exportó o ingresó, y cuándo. */
  @Get('auditoria/bitacora')
  @RequierePermiso('USUARIO_GESTIONAR')
  bitacora(@UsuarioActual() usuario: UsuarioSesion, @Query() q: BitacoraDto) {
    return this.titular.bitacora(usuario, q);
  }
}
