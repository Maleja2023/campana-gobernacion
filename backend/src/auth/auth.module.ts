import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AutenticacionGuard } from './autenticacion.guard.js';
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
        return {
          secret: secreto,
          signOptions: { expiresIn: config.get<string>('JWT_DURACION') ?? '8h' } as never,
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    // Orden: primero autenticación (¿quién es?), luego permisos (¿puede hacerlo?)
    { provide: APP_GUARD, useClass: AutenticacionGuard },
    { provide: APP_GUARD, useClass: PermisosGuard },
  ],
})
export class AuthModule {}
