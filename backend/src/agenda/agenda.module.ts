import { Module } from '@nestjs/common';
import { AgendaController } from './agenda.controller.js';
import { AgendaRepositorio } from './agenda.repositorio.js';
import { AgendaService } from './agenda.service.js';
import { AsistenciaController, CheckinPublicoController } from './checkin.controller.js';
import { CheckinRepositorio } from './checkin.repositorio.js';
import { CheckinService } from './checkin.service.js';

@Module({
  controllers: [AgendaController, AsistenciaController, CheckinPublicoController],
  providers: [AgendaService, AgendaRepositorio, CheckinService, CheckinRepositorio],
})
export class AgendaModule {}
