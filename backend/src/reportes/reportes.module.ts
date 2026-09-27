import { Module } from '@nestjs/common';
import { ReportesController } from './reportes.controller.js';
import { ReportesRepositorio } from './reportes.repositorio.js';
import { ReportesService } from './reportes.service.js';

@Module({
  controllers: [ReportesController],
  providers: [ReportesService, ReportesRepositorio],
})
export class ReportesModule {}
