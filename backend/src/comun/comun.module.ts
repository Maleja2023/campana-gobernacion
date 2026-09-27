import { Global, Module } from '@nestjs/common';
import { AuditoriaRepositorio } from './auditoria/auditoria.repositorio.js';
import { CaptchaService } from './captcha/captcha.service.js';

/** Infraestructura compartida entre módulos: auditoría de seguridad, errores, etc. */
@Global()
@Module({
  providers: [AuditoriaRepositorio, CaptchaService],
  exports: [AuditoriaRepositorio, CaptchaService],
})
export class ComunModule {}
