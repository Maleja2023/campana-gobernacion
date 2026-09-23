import { Controller, Get, Query } from '@nestjs/common';
import { RequierePermiso, UsuarioActual } from '../auth/decoradores.js';
import type { UsuarioSesion } from '../auth/auth.types.js';
import {
  MunicipioQueryDto,
  RankingQueryDto,
  RegistrosDiariosQueryDto,
} from './dto/tablero-query.dto.js';
import { TableroService } from './tablero.service.js';

@Controller('tablero')
export class TableroController {
  constructor(private readonly tablero: TableroService) {}

  @Get('indicadores')
  @RequierePermiso('REPORTE_VER')
  indicadores(@UsuarioActual() usuario: UsuarioSesion) {
    return this.tablero.indicadores(usuario);
  }

  @Get('registros-diarios')
  @RequierePermiso('REPORTE_VER')
  registrosDiarios(@UsuarioActual() usuario: UsuarioSesion, @Query() query: RegistrosDiariosQueryDto) {
    return this.tablero.registrosDiarios(usuario, query.desde, query.hasta, query.municipioId);
  }

  @Get('ranking')
  @RequierePermiso('REPORTE_VER')
  ranking(@UsuarioActual() usuario: UsuarioSesion, @Query() query: RankingQueryDto) {
    return this.tablero.ranking(usuario, query.limite);
  }

  @Get('lideres-inactivos')
  @RequierePermiso('REPORTE_VER')
  lideresInactivos(@UsuarioActual() usuario: UsuarioSesion) {
    return this.tablero.lideresInactivos(usuario);
  }

  @Get('metas')
  @RequierePermiso('REPORTE_VER')
  metas(@UsuarioActual() usuario: UsuarioSesion) {
    return this.tablero.metas(usuario);
  }

  @Get('necesidades')
  @RequierePermiso('REPORTE_VER')
  necesidades(@UsuarioActual() usuario: UsuarioSesion, @Query() query: MunicipioQueryDto) {
    return this.tablero.necesidades(usuario, query.municipioId);
  }

  @Get('puestos')
  @RequierePermiso('MAPA_VER')
  puestos(@UsuarioActual() usuario: UsuarioSesion, @Query() query: MunicipioQueryDto) {
    return this.tablero.puestos(usuario, query.municipioId);
  }
}