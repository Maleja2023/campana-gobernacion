import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module.js';
import { CifradoModule } from './cifrado/cifrado.module.js';
import { DatabaseModule } from './database/database.module.js';
import { SaludModule } from './salud/salud.module.js';
import { SimpatizantesModule } from './simpatizantes/simpatizantes.module.js';
import { TerritorioModule } from './territorio/territorio.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Límite general: 120 peticiones por minuto por IP
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    DatabaseModule,
    CifradoModule,
    AuthModule,
    SaludModule,
    SimpatizantesModule,
    TerritorioModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
