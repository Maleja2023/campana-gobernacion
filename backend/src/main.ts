import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  app.enableCors({ origin: process.env.CORS_ORIGEN ?? 'http://localhost:5173' });

  const puerto = Number(process.env.PORT ?? 3000);
  await app.listen(puerto);
  Logger.log(`API lista en http://localhost:${puerto}/api`, 'Arranque');
}
await bootstrap();
