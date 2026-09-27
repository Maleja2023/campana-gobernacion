import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { json } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { requestIdMiddleware } from './comun/middleware/request-id.middleware.js';

/** Límite del cuerpo JSON: la API no recibe archivos, solo formularios cortos. */
const LIMITE_CUERPO_JSON = '100kb';

async function bootstrap() {
  // Se desactiva el parser por defecto para fijar nosotros el límite de tamaño.
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  const config = app.get(ConfigService);

  const origenesPermitidos = config
    .getOrThrow<string>('CORS_ORIGENES')
    .split(',')
    .map((origen) => origen.trim());
  const confiarEnProxy = config.get<string>('TRUST_PROXY') === 'true';

  // Detrás de Cloudflare/otro proxy en producción: TRUST_PROXY=true para que
  // req.ip (usado por el límite de peticiones y la auditoría) sea la IP real
  // del visitante y no la del proxy. Desactivado por defecto.
  const instanciaExpress = app.getHttpAdapter().getInstance();
  instanciaExpress.set('trust proxy', confiarEnProxy);
  instanciaExpress.disable('x-powered-by');

  app.use(requestIdMiddleware);
  app.use(helmet());
  app.use(json({ limit: LIMITE_CUERPO_JSON }));
  app.use(cookieParser());

  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  app.enableCors({
    origin: origenesPermitidos,
    // La sesión vive en cookies: el navegador solo las manda/acepta en
    // peticiones con credenciales, y únicamente si el origen es explícito
    // (nunca con '*', que ya no usamos).
    credentials: true,
    methods: ['GET', 'POST', 'PATCH'],
    allowedHeaders: ['Content-Type', 'X-Requested-With'],
    exposedHeaders: ['x-request-id'],
  });
  // Rechaza cuerpos con campos de más o con tipos equivocados
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));

  const puerto = config.get<number>('PORT') ?? 3000;
  await app.listen(puerto);
  Logger.log(`API lista en http://localhost:${puerto}/api`, 'Arranque');
}
await bootstrap();
