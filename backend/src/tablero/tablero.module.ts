import { Module } from '@nestjs/common';
import { TableroController } from './tablero.controller.js';
import { TableroRepositorio } from './tablero.repositorio.js';
import { TableroService } from './tablero.service.js';

@Module({
  controllers: [TableroController],
  providers: [TableroService, TableroRepositorio],
})
export class TableroModule {}