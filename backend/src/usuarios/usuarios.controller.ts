import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { RequierePermiso, UsuarioActual } from '../auth/decoradores.js';
import type { UsuarioSesion } from '../auth/auth.types.js';
import { ActualizarUsuarioDto, CrearUsuarioDto, ListaUsuariosQueryDto } from './dto/usuarios.dto.js';
import { UsuariosService } from './usuarios.service.js';

@Controller('usuarios')
@RequierePermiso('USUARIO_GESTIONAR')
export class UsuariosController {
  constructor(private readonly usuarios: UsuariosService) {}

  @Get()
  listar(@UsuarioActual() usuario: UsuarioSesion, @Query() query: ListaUsuariosQueryDto) {
    return this.usuarios.listar(usuario, query.texto, query.activo, query.pagina, query.porPagina);
  }

  @Get('roles-asignables')
  rolesAsignables(@UsuarioActual() usuario: UsuarioSesion) {
    return this.usuarios.rolesAsignables(usuario);
  }

  @Post()
  crear(@UsuarioActual() usuario: UsuarioSesion, @Body() dto: CrearUsuarioDto) {
    return this.usuarios.crear(usuario, dto);
  }

  @Patch(':usuarioId')
  actualizar(@UsuarioActual() usuario: UsuarioSesion, @Param('usuarioId', new ParseUUIDPipe()) usuarioId: string, @Body() dto: ActualizarUsuarioDto) {
    return this.usuarios.actualizar(usuario, usuarioId, dto);
  }

  @Post(':usuarioId/restablecer-clave')
  restablecerClave(@UsuarioActual() usuario: UsuarioSesion, @Param('usuarioId', new ParseUUIDPipe()) usuarioId: string) {
    return this.usuarios.restablecerClave(usuario, usuarioId);
  }

  @Post(':usuarioId/restablecer-mfa')
  restablecerMfa(
    @UsuarioActual() usuario: UsuarioSesion,
    @Param('usuarioId', new ParseUUIDPipe()) usuarioId: string,
    @Req() req: Request,
  ) {
    return this.usuarios.restablecerMfa(usuario, usuarioId, req.ip ?? null);
  }
}