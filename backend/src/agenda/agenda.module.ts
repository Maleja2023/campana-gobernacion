import { Module } from '@nestjs/common';
import { AgendaController } from './agenda.controller.js';
import { AgendaRepositorio } from './agenda.repositorio.js';
import { AgendaService } from './agenda.service.js';

@Module({ controllers: [AgendaController], providers: [AgendaService, AgendaRepositorio] })
export class AgendaModule {}