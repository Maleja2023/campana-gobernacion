import { Global, Module } from '@nestjs/common';
import { CifradoService } from './cifrado.service.js';

@Global()
@Module({
  providers: [CifradoService],
  exports: [CifradoService],
})
export class CifradoModule {}