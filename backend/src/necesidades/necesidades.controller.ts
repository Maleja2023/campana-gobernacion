import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { RequierePermiso, UsuarioActual } from '../auth/decoradores.js';
import type { UsuarioSesion } from '../auth/auth.types.js';
import { CATEGORIAS, DEFINICIONES } from './categorias.js';
import { CorregirCategoriaDto, ListadoNecesidadesDto } from './dto/necesidades.dto.js';
import { NecesidadesService } from './necesidades.service.js';

@Controller('necesidades')
export class NecesidadesController {
  constructor(private readonly necesidades: NecesidadesService) {}

  @Get('categorias')
  @RequierePermiso('REPORTE_VER')
  categorias() {
    return CATEGORIAS.map((codigo) => ({ codigo, descripcion: DEFINICIONES[codigo] }));
  }

  /** GET /api/necesidades?municipioId=&categoria=&pagina= — sin datos de quién reportó. */
  @Get()
  @RequierePermiso('REPORTE_VER')
  listado(@UsuarioActual() usuario: UsuarioSesion, @Query() q: ListadoNecesidadesDto) {
    return this.necesidades.listado(usuario, q);
  }

  @Get('resumen')
  @RequierePermiso('REPORTE_VER')
  resumen(@UsuarioActual() usuario: UsuarioSesion) {
    return this.necesidades.resumen(usuario);
  }

  /** Avance de la clasificación y si la IA está configurada. */
  @Get('clasificacion')
  @RequierePermiso('REPORTE_VER')
  estado(@UsuarioActual() usuario: UsuarioSesion) {
    return this.necesidades.estado(usuario);
  }

  /** POST /api/necesidades/clasificar — clasifica ya lo pendiente (también corre sola cada 10 minutos). */
  @Post('clasificar')
  @RequierePermiso('AGENDA_GESTIONAR')
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @HttpCode(200)
  clasificar() {
    return this.necesidades.clasificarPendientes();
  }

  /** PATCH /api/necesidades/:id/categoria — corrección manual (manda sobre la IA). */
  @Patch(':id/categoria')
  @RequierePermiso('AGENDA_GESTIONAR')
  corregir(@UsuarioActual() usuario: UsuarioSesion, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: CorregirCategoriaDto) {
    return this.necesidades.corregirCategoria(usuario, id, dto.categoria);
  }

  @Get('informes/:municipioId')
  @RequierePermiso('REPORTE_VER')
  informe(@UsuarioActual() usuario: UsuarioSesion, @Param('municipioId', ParseIntPipe) municipioId: number) {
    return this.necesidades.ultimoInforme(usuario, municipioId);
  }

  /** POST /api/necesidades/informes/:municipioId — informe con IA (insumo del programa de gobierno). */
  @Post('informes/:municipioId')
  @RequierePermiso('REPORTE_VER', 'AGENDA_VER')
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @HttpCode(202)
  generar(@UsuarioActual() usuario: UsuarioSesion, @Param('municipioId', ParseIntPipe) municipioId: number) {
    return this.necesidades.generarInforme(usuario, municipioId);
  }
}
