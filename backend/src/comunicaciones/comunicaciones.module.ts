import { Module } from '@nestjs/common';
import { BajaController, ComunicacionesController, NotificacionesController } from './comunicaciones.controller.js';
import { ComunicacionesRepositorio } from './comunicaciones.repositorio.js';
import { ComunicacionesService } from './comunicaciones.service.js';
import { EnviosProceso } from './envios.proceso.js';
import { ProveedoresService } from './proveedores.service.js';

@Module({
  controllers: [NotificacionesController, ComunicacionesController, BajaController],
  providers: [ComunicacionesService, ComunicacionesRepositorio, EnviosProceso, ProveedoresService],
})
export class ComunicacionesModule {}
