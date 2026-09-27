import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Query, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Publico, RequierePermiso, UsuarioActual } from '../auth/decoradores.js';
import type { UsuarioSesion } from '../auth/auth.types.js';
import { EditarSimpatizanteDto } from './dto/editar-simpatizante.dto.js';
import { ExportarSimpatizantesDto } from './dto/exportar-simpatizantes.dto.js';
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

  @Get('registro/link/:codigo')
  @Publico()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  validarLink(@Param('codigo') codigo: string) {
    return this.simpatizantes.validarLink(codigo);
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
    @Query('liderId', new ParseUUIDPipe({ optional: true })) liderId?: string,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
  ) {
    return this.simpatizantes.listar(usuario, {
      municipioId,
      territorioId,
      estado,
      texto: texto?.trim(),
      liderId,
      desde,
      hasta,
      pagina: Math.max(1, pagina),
      porPagina: Math.min(100, Math.max(1, porPagina)),
    });
  }

  @Get('simpatizantes/:personaId/documento')
  @RequierePermiso('DOCUMENTO_VER')
  documento(@Param('personaId', new ParseUUIDPipe()) personaId: string, @UsuarioActual() usuario: UsuarioSesion) {
    return this.simpatizantes.documento(usuario, personaId);
  }

  @Patch('simpatizantes/:personaId')
  @RequierePermiso('SIMPATIZANTE_EDITAR')
  editar(
    @Param('personaId', new ParseUUIDPipe()) personaId: string,
    @Body() dto: EditarSimpatizanteDto,
    @UsuarioActual() usuario: UsuarioSesion,
  ) {
    return this.simpatizantes.editar(usuario, personaId, dto);
  }

  @Post('simpatizantes/:personaId/retirar')
  @RequierePermiso('SIMPATIZANTE_EDITAR')
  @HttpCode(200)
  retirar(@Param('personaId', new ParseUUIDPipe()) personaId: string, @UsuarioActual() usuario: UsuarioSesion) {
    return this.simpatizantes.retirar(usuario, personaId);
  }

  /** POST /api/simpatizantes/exportar — exige un motivo; queda auditado en
   * auditoria.exportaciones (quién, motivo, formato, cuántos, qué territorios).
   *
   * Exige también SIMPATIZANTE_VER para no depender de que la asignación de
   * roles actual siga igual: EXPORTAR es el permiso de la acción, pero quien
   * exporta esta lista debe poder verla. Límite bajo porque cada llamada puede
   * mover miles de filas: frena la exfiltración masiva con una cuenta robada. */
  @Post('simpatizantes/exportar')
  @RequierePermiso('EXPORTAR', 'SIMPATIZANTE_VER')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  async exportar(@Body() dto: ExportarSimpatizantesDto, @UsuarioActual() usuario: UsuarioSesion, @Res({ passthrough: true }) res: Response) {
    const { buffer, cantidad } = await this.simpatizantes.exportar(usuario, dto);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="simpatizantes.xlsx"',
      'X-Cantidad-Exportada': String(cantidad),
    });
    return buffer;
  }
}