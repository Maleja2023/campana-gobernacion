import { Module } from '@nestjs/common';
import { RedController } from './red.controller.js';
import { RedRepositorio } from './red.repositorio.js';
import { RedService } from './red.service.js';

@Module({
  controllers: [RedController],
  providers: [RedService, RedRepositorio],
})
export class RedModule {}