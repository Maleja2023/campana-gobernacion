import { Module } from '@nestjs/common';
import { DiaDController } from './dia-d.controller.js';
import { DiaDRepositorio } from './dia-d.repositorio.js';
import { DiaDService } from './dia-d.service.js';

@Module({ controllers: [DiaDController], providers: [DiaDService, DiaDRepositorio] })
export class DiaDModule {}
