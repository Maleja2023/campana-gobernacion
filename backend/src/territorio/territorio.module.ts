import { Module } from '@nestjs/common';
import { TerritorioController } from './territorio.controller.js';
import { TerritorioRepositorio } from './territorio.repositorio.js';
import { TerritorioService } from './territorio.service.js';

@Module({
  controllers: [TerritorioController],
  providers: [TerritorioService, TerritorioRepositorio],
})
export class TerritorioModule {}
