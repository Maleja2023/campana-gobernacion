import { Module } from '@nestjs/common';
import { RedController } from './red.controller.js';
import { RedService } from './red.service.js';

@Module({
  controllers: [RedController],
  providers: [RedService],
})
export class RedModule {}