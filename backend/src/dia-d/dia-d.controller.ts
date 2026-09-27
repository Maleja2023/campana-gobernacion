import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, ParseUUIDPipe, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { RequierePermiso, UsuarioActual } from '../auth/decoradores.js';
import type { UsuarioSesion } from '../auth/auth.types.js';
import { DiaDService, TAMANO_MAXIMO_FOTO, type ArchivoSubido } from './dia-d.service.js';
import {
  CandidatoDto,
  CargarE14Dto,
  CorporacionQueryDto,
  JornadaDto,
  MesasDto,
  MunicipioQueryDto,
  RevisarE14Dto,
  RevisionQueryDto,
  TestigoDto,
} from './dto/dia-d.dto.js';

/**
 * Día de elecciones. Además del permiso de cada ruta, la base verifica el
 * territorio (coordinador: su municipio) y, para el testigo, que la mesa sea suya.
 */
@Controller('dia-d')
export class DiaDController {
  constructor(private readonly diaD: DiaDService) {}

  @Get('jornadas')
  jornadas(@UsuarioActual() u: UsuarioSesion) {
    return this.diaD.jornadas(u);
  }

  @Post('jornadas')
  @RequierePermiso('DIA_D_CONFIGURAR')
  crearJornada(@UsuarioActual() u: UsuarioSesion, @Body() dto: JornadaDto) {
    return this.diaD.crearJornada(u, dto);
  }

  /** Tarjetón de la jornada activa (testigos, tablero y configuración). */
  @Get('opciones')
  opciones(@UsuarioActual() u: UsuarioSesion, @Query() q: CorporacionQueryDto) {
    return this.diaD.opciones(u, q.corporacion);
  }

  @Post('candidatos')
  @RequierePermiso('DIA_D_CONFIGURAR')
  candidato(@UsuarioActual() u: UsuarioSesion, @Body() dto: CandidatoDto) {
    return this.diaD.guardarCandidato(u, dto);
  }

  @Delete('candidatos/:id')
  @RequierePermiso('DIA_D_CONFIGURAR')
  quitarCandidato(@UsuarioActual() u: UsuarioSesion, @Param('id', ParseIntPipe) id: number) {
    return this.diaD.quitarCandidato(u, id);
  }

  @Get('puestos')
  puestos(@UsuarioActual() u: UsuarioSesion, @Query() q: MunicipioQueryDto) {
    return this.diaD.puestos(u, q.municipioId);
  }

  @Post('puestos/:id/mesas')
  @RequierePermiso('DIA_D_CONFIGURAR')
  @HttpCode(200)
  definirMesas(@UsuarioActual() u: UsuarioSesion, @Param('id', ParseIntPipe) id: number, @Body() dto: MesasDto) {
    return this.diaD.definirMesas(u, id, dto.cantidad);
  }

  @Get('puestos/:id/mesas')
  @RequierePermiso('DIA_D_GESTIONAR')
  mesas(@UsuarioActual() u: UsuarioSesion, @Param('id', ParseIntPipe) id: number) {
    return this.diaD.mesasPuesto(u, id);
  }

  @Get('testigos')
  @RequierePermiso('DIA_D_GESTIONAR')
  testigos(@UsuarioActual() u: UsuarioSesion) {
    return this.diaD.testigos(u);
  }

  @Post('mesas/:id/testigo')
  @RequierePermiso('DIA_D_GESTIONAR')
  @HttpCode(200)
  asignar(@UsuarioActual() u: UsuarioSesion, @Param('id', ParseIntPipe) id: number, @Body() dto: TestigoDto) {
    return this.diaD.asignarTestigo(u, id, dto.usuarioId);
  }

  @Get('mis-mesas')
  @RequierePermiso('E14_CARGAR')
  misMesas(@UsuarioActual() u: UsuarioSesion) {
    return this.diaD.misMesas(u);
  }

  /** multipart/form-data: foto, mesaId, corporacion, votos (JSON). */
  @Post('e14')
  @UseInterceptors(FileInterceptor('foto', { limits: { fileSize: TAMANO_MAXIMO_FOTO, files: 1, fields: 5 } }))
  cargarE14(@UsuarioActual() u: UsuarioSesion, @Body() dto: CargarE14Dto, @UploadedFile() foto: ArchivoSubido | undefined) {
    return this.diaD.cargarE14(u, dto, foto);
  }

  @Get('e14/:id/foto')
  async foto(@UsuarioActual() u: UsuarioSesion, @Param('id', new ParseUUIDPipe()) id: string, @Res() res: Response) {
    const { contenido, contentType } = await this.diaD.fotoE14(u, id);
    res.set({ 'Content-Type': contentType, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
    res.send(contenido);
  }

  @Get('revision')
  @RequierePermiso('DIA_D_GESTIONAR')
  revision(@UsuarioActual() u: UsuarioSesion, @Query() q: RevisionQueryDto) {
    return this.diaD.revision(u, q.estado, q.municipioId);
  }

  @Post('e14/:id/revision')
  @RequierePermiso('DIA_D_GESTIONAR')
  @HttpCode(200)
  revisar(@UsuarioActual() u: UsuarioSesion, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: RevisarE14Dto) {
    return this.diaD.revisar(u, id, dto.estado, dto.observacion);
  }

  @Get('conteo')
  @RequierePermiso('DIA_D_VER')
  conteo(@UsuarioActual() u: UsuarioSesion, @Query() q: CorporacionQueryDto) {
    return this.diaD.conteo(u, q.corporacion, q.municipioId);
  }
}
