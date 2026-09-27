import { Module } from '@nestjs/common';
import { CalidadController } from './calidad.controller.js';
import { CalidadRepositorio } from './calidad.repositorio.js';
import { CalidadService } from './calidad.service.js';

@Module({
  controllers: [CalidadController],
  providers: [CalidadService, CalidadRepositorio],
})
export class CalidadModule {}
