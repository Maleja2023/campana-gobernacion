import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller.js';
import { AuthRepositorio } from './auth.repositorio.js';
import { AuthService } from './auth.service.js';
import { AutenticacionGuard } from './autenticacion.guard.js';
import { DURACION_ACCESO } from './cookies.js';
import { CsrfGuard } from '../comun/guards/csrf.guard.js';
import { EstadoSesionGuard } from '../comun/guards/estado-sesion.guard.js';
import { MfaController } from './mfa.controller.js';
import { MfaRepositorio } from './mfa.repositorio.js';
import { MfaService } from './mfa.service.js';
import { PermisosGuard } from './permisos.guard.js';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secreto = config.getOrThrow<string>('JWT_SECRETO');
        if (secreto.length < 32) {
          throw new Error('JWT_SECRETO debe tener al menos 32 caracteres');
        }
        // Token de acceso siempre corto: la sesión larga vive en la cookie
        // de renovación (rotativa), no en este token.
        return { secret: secreto, signOptions: { expiresIn: DURACION_ACCESO } as never };
      },
    }),
  ],
  controllers: [AuthController, MfaController],
  providers: [
    AuthService,
    AuthRepositorio,
    MfaService,
    MfaRepositorio,
    // Orden: CSRF (antes de tocar nada), autenticación (¿quién es?),
    // estado de la sesión (¿le falta algo por completar?), y por último
    // permisos (¿puede hacer esto en particular?).
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: AutenticacionGuard },
    { provide: APP_GUARD, useClass: EstadoSesionGuard },
    { provide: APP_GUARD, useClass: PermisosGuard },
  ],
  exports: [MfaRepositorio],
})
export class AuthModule {}
