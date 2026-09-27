import { Module } from '@nestjs/common';
import { MantenimientoService } from './mantenimiento.service.js';

@Module({ providers: [MantenimientoService] })
export class MantenimientoModule {}
