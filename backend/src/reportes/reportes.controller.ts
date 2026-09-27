import { Body, Controller, Get, HttpCode, Post, Query, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { RequierePermiso, UsuarioActual } from '../auth/decoradores.js';
import type { UsuarioSesion } from '../auth/auth.types.js';
import { BitacoraQueryDto, ExportarReporteDto, ReporteQueryDto } from './dto/reportes.dto.js';
import { ReportesService } from './reportes.service.js';

@Controller('reportes')
export class ReportesController {
  constructor(private readonly reportes: ReportesService) {}

  /** GET /api/reportes/municipios?desde=&hasta=&municipioId= */
  @Get('municipios')
  @RequierePermiso('REPORTE_VER')
  municipios(@UsuarioActual() usuario: UsuarioSesion, @Query() q: ReporteQueryDto) {
    return this.reportes.municipios(usuario, q);
  }

  /** GET /api/reportes/lideres?municipioId=&miembroId=&desde=&hasta= */
  @Get('lideres')
  @RequierePermiso('REPORTE_VER')
  lideres(@UsuarioActual() usuario: UsuarioSesion, @Query() q: ReporteQueryDto) {
    return this.reportes.lideres(usuario, q);
  }

  /** GET /api/reportes/puestos?municipioId=&miembroId=&desde=&hasta= */
  @Get('puestos')
  @RequierePermiso('REPORTE_VER')
  puestos(@UsuarioActual() usuario: UsuarioSesion, @Query() q: ReporteQueryDto) {
    return this.reportes.puestos(usuario, q);
  }

  /** GET /api/reportes/proyeccion: cumplimiento proyectado de cada meta visible. */
  @Get('proyeccion')
  @RequierePermiso('REPORTE_VER')
  proyeccion(@UsuarioActual() usuario: UsuarioSesion) {
    return this.reportes.proyeccion(usuario);
  }

  /** POST /api/reportes/exportar: Excel de un reporte. Exige motivo y queda en
   * la bitácora de exportaciones (quién, qué reporte, motivo, cuántas filas). */
  @Post('exportar')
  @RequierePermiso('EXPORTAR', 'REPORTE_VER')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  async exportar(@Body() dto: ExportarReporteDto, @UsuarioActual() usuario: UsuarioSesion, @Res({ passthrough: true }) res: Response) {
    const { buffer, cantidad, nombre } = await this.reportes.exportar(usuario, dto);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${nombre}"`,
      'X-Cantidad-Exportada': String(cantidad),
    });
    return buffer;
  }

  /** GET /api/reportes/exportaciones: bitácora de todo lo exportado. */
  @Get('exportaciones')
  @RequierePermiso('USUARIO_GESTIONAR')
  bitacora(@UsuarioActual() usuario: UsuarioSesion, @Query() q: BitacoraQueryDto) {
    return this.reportes.bitacora(usuario, q.limite);
  }
}
