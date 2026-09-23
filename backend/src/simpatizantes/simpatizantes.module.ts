import { Module } from '@nestjs/common';
import { SimpatizantesController } from './simpatizantes.controller.js';
import { SimpatizantesService } from './simpatizantes.service.js';

@Module({
  controllers: [SimpatizantesController],
  providers: [SimpatizantesService],
})
export class SimpatizantesModule {}