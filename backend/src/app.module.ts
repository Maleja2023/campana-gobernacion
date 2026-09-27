import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module.js';
import { AgendaModule } from './agenda/agenda.module.js';
import { CalidadModule } from './calidad/calidad.module.js';
import { CifradoModule } from './cifrado/cifrado.module.js';
import { validarVariablesEntorno } from './comun/config/variables-entorno.js';
import { ComunModule } from './comun/comun.module.js';
import { ExcepcionesFilter } from './comun/filtros/excepciones.filter.js';
import { DatabaseModule } from './database/database.module.js';
import { MantenimientoModule } from './mantenimiento/mantenimiento.module.js';
import { SaludModule } from './salud/salud.module.js';
import { SimpatizantesModule } from './simpatizantes/simpatizantes.module.js';
import { NecesidadesModule } from './necesidades/necesidades.module.js';
import { RedModule } from './red/red.module.js';
import { ReportesModule } from './reportes/reportes.module.js';
import { TableroModule } from './tablero/tablero.module.js';
import { TerritorioModule } from './territorio/territorio.module.js';
import { ComunicacionesModule } from './comunicaciones/comunicaciones.module.js';
import { DiaDModule } from './dia-d/dia-d.module.js';
import { TitularModule } from './titular/titular.module.js';
import { UsuariosModule } from './usuarios/usuarios.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validarVariablesEntorno }),
    ScheduleModule.forRoot(),
    // Límite general: 120 peticiones por minuto por IP
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    ComunModule,
    DatabaseModule,
    CifradoModule,
    AuthModule,
    AgendaModule,
    CalidadModule,
    MantenimientoModule,
    NecesidadesModule,
    SaludModule,
    SimpatizantesModule,
    RedModule,
    ReportesModule,
    TableroModule,
    TerritorioModule,
    TitularModule,
    ComunicacionesModule,
    DiaDModule,
    UsuariosModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Único lugar que traduce errores de dominio y de Postgres a HTTP.
    { provide: APP_FILTER, useClass: ExcepcionesFilter },
  ],
})
export class AppModule {}
