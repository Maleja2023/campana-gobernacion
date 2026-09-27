import { Module } from '@nestjs/common';
import { IaService } from './ia.service.js';
import { NecesidadesController } from './necesidades.controller.js';
import { NecesidadesRepositorio } from './necesidades.repositorio.js';
import { NecesidadesService } from './necesidades.service.js';

@Module({
  controllers: [NecesidadesController],
  providers: [NecesidadesService, NecesidadesRepositorio, IaService],
})
export class NecesidadesModule {}
