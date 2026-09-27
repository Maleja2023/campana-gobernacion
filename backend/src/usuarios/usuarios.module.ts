import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { UsuariosController } from './usuarios.controller.js';
import { UsuariosRepositorio } from './usuarios.repositorio.js';
import { UsuariosService } from './usuarios.service.js';

@Module({
  imports: [AuthModule],
  controllers: [UsuariosController],
  providers: [UsuariosService, UsuariosRepositorio],
})
export class UsuariosModule {}