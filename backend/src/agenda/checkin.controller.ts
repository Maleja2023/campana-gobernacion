import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Publico, RequierePermiso, UsuarioActual } from '../auth/decoradores.js';
import type { UsuarioSesion } from '../auth/auth.types.js';
import { CheckinService } from './checkin.service.js';
import { AsistenciaManualDto, CheckinDto, ComparativoDto } from './dto/checkin.dto.js';

/** Check-in público de asistentes por el QR del evento (/e/<código>). */
@Controller('eventos-publico')
export class CheckinPublicoController {
  constructor(private readonly checkin: CheckinService) {}

  /** GET /api/eventos-publico/:codigo — nombre, lugar, horario y si el registro está abierto. */
  @Get(':codigo')
  @Publico()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  info(@Param('codigo') codigo: string) {
    return this.checkin.info(codigo);
  }

  /** POST /api/eventos-publico/:codigo/checkin */
  @Post(':codigo/checkin')
  @Publico()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  registrar(@Param('codigo') codigo: string, @Body() dto: CheckinDto, @Req() req: Request) {
    return this.checkin.checkin(codigo, dto, req.ip ?? null, req.get('user-agent') ?? null);
  }
}

/** Asistencia de los eventos para el equipo. */
@Controller('agenda')
export class AsistenciaController {
  constructor(private readonly checkin: CheckinService) {}

  /** GET /api/agenda/visitas/:id/asistencia — código del QR y lista de asistentes. */
  @Get('visitas/:id/asistencia')
  @RequierePermiso('AGENDA_VER')
  asistencia(@UsuarioActual() u: UsuarioSesion, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.checkin.asistencia(u, id);
  }

  /** POST /api/agenda/visitas/:id/asistencia — marcar a alguien por su cédula. */
  @Post('visitas/:id/asistencia')
  @RequierePermiso('AGENDA_GESTIONAR')
  @HttpCode(200)
  marcar(@UsuarioActual() u: UsuarioSesion, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: AsistenciaManualDto) {
    return this.checkin.marcar(u, id, dto.documento);
  }

  /** GET /api/agenda/comparativo — asistencia a eventos frente a referidos por zona. */
  @Get('comparativo')
  @RequierePermiso('AGENDA_VER')
  comparativo(@UsuarioActual() u: UsuarioSesion, @Query() q: ComparativoDto) {
    return this.checkin.comparativo(u, q);
  }
}
