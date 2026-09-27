import { Module } from '@nestjs/common';
import { CumplimientoController, TitularController } from './titular.controller.js';
import { TitularRepositorio } from './titular.repositorio.js';
import { TitularService } from './titular.service.js';

@Module({
  controllers: [TitularController, CumplimientoController],
  providers: [TitularService, TitularRepositorio],
})
export class TitularModule {}
