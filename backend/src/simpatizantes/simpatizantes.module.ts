import { Module } from '@nestjs/common';
import { SimpatizantesController } from './simpatizantes.controller.js';
import { SimpatizantesRepositorio } from './simpatizantes.repositorio.js';
import { SimpatizantesService } from './simpatizantes.service.js';

@Module({
  controllers: [SimpatizantesController],
  providers: [SimpatizantesService, SimpatizantesRepositorio],
})
export class SimpatizantesModule {}