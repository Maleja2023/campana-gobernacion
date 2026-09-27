import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

declare module 'express' {
  interface Request {
    /** Identificador único de la petición: correlaciona logs y respuestas de error. */
    requestId: string;
  }
}

/**
 * Genera un id propio por petición (nunca se confía en un `x-request-id` que
 * mande el cliente: permitiría inyectar valores arbitrarios en los logs) y lo
 * expone también en la respuesta para que el usuario lo reporte a soporte.
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
  req.requestId = randomUUID();
  res.setHeader('x-request-id', req.requestId);
  next();
}
