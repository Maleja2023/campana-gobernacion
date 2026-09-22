import { Module } from '@nestjs/common';
import { SaludController } from './salud.controller.js';

@Module({ controllers: [SaludController] })
export class SaludModule {}
