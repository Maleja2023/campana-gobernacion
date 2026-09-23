import { Module } from '@nestjs/common';
import { TableroController } from './tablero.controller.js';
import { TableroService } from './tablero.service.js';

@Module({
  controllers: [TableroController],
  providers: [TableroService],
})
export class TableroModule {}