import { Body, Controller, Get, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { RequierePermiso, UsuarioActual } from '../auth/decoradores.js';
import type { UsuarioSesion } from '../auth/auth.types.js';
import { ActualizarCompromisoDto, ActualizarVisitaDto, CompromisoDto, CompromisosQueryDto, PlanteamientoDto, ReporteDto, VisitaDto, VisitasQueryDto } from './dto/agenda.dto.js';
import { AgendaService } from './agenda.service.js';

@Controller('agenda')
export class AgendaController {
  constructor(private readonly agenda: AgendaService) {}
  @Get('visitas') @RequierePermiso('AGENDA_VER') visitas(@UsuarioActual() u: UsuarioSesion, @Query() q: VisitasQueryDto) { return this.agenda.visitas(u, q); }
  @Get('visitas/:id') @RequierePermiso('AGENDA_VER') visita(@UsuarioActual() u: UsuarioSesion, @Param('id', new ParseUUIDPipe()) id: string) { return this.agenda.visita(u, id); }
  @Post('visitas') @RequierePermiso('AGENDA_GESTIONAR') crearVisita(@UsuarioActual() u: UsuarioSesion, @Body() dto: VisitaDto) { return this.agenda.crearVisita(u, dto); }
  @Patch('visitas/:id') @RequierePermiso('AGENDA_GESTIONAR') actualizarVisita(@UsuarioActual() u: UsuarioSesion, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: ActualizarVisitaDto) { return this.agenda.actualizarVisita(u, id, dto); }
  @Post('visitas/:id/planteamientos') @RequierePermiso('AGENDA_GESTIONAR') planteamiento(@UsuarioActual() u: UsuarioSesion, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: PlanteamientoDto) { return this.agenda.planteamiento(u, id, dto); }
  @Post('reportes-comunitarios') @RequierePermiso('REPORTE_COMUNITARIO') reporte(@UsuarioActual() u: UsuarioSesion, @Body() dto: ReporteDto) { return this.agenda.reporte(u, dto); }
  @Get('reportes-comunitarios/mios') @RequierePermiso('REPORTE_COMUNITARIO') misReportes(@UsuarioActual() u: UsuarioSesion) { return this.agenda.misReportes(u); }
  @Get('compromisos') @RequierePermiso('AGENDA_VER') compromisos(@UsuarioActual() u: UsuarioSesion, @Query() q: CompromisosQueryDto) { return this.agenda.compromisos(u, q); }
  @Post('compromisos') @RequierePermiso('AGENDA_GESTIONAR') crearCompromiso(@UsuarioActual() u: UsuarioSesion, @Body() dto: CompromisoDto) { return this.agenda.crearCompromiso(u, dto); }
  @Patch('compromisos/:id') @RequierePermiso('AGENDA_GESTIONAR') actualizarCompromiso(@UsuarioActual() u: UsuarioSesion, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: ActualizarCompromisoDto) { return this.agenda.actualizarCompromiso(u, id, dto); }
  @Get('cobertura') @RequierePermiso('AGENDA_VER') cobertura(@UsuarioActual() u: UsuarioSesion, @Query('padre', new ParseIntPipe({ optional: true })) padre?: number) { return this.agenda.cobertura(u, padre); }
  @Get('catalogos') @RequierePermiso('AGENDA_VER') catalogos(@UsuarioActual() u: UsuarioSesion) { return this.agenda.catalogos(u); }
}