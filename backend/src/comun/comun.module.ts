import { Global, Module } from '@nestjs/common';
import { AuditoriaRepositorio } from './auditoria/auditoria.repositorio.js';

/** Infraestructura compartida entre módulos: auditoría de seguridad, errores, etc. */
@Global()
@Module({
  providers: [AuditoriaRepositorio],
  exports: [AuditoriaRepositorio],
})
export class ComunModule {}
