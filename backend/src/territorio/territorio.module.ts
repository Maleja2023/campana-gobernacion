import { Module } from '@nestjs/common';
import { TerritorioController } from './territorio.controller.js';
import { TerritorioService } from './territorio.service.js';

@Module({
  controllers: [TerritorioController],
  providers: [TerritorioService],
})
export class TerritorioModule {}
