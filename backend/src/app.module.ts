import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module.js';
import { SaludModule } from './salud/salud.module.js';
import { TerritorioModule } from './territorio/territorio.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    SaludModule,
    TerritorioModule,
  ],
})
export class AppModule {}
