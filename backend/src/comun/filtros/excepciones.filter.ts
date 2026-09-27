import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  ConflictoError,
  NoAutorizadoError,
  NoEncontradoError,
  PermisoError,
  ReglaNegocioError,
} from '../errores/errores-dominio.js';
import { esErrorPostgres, esViolacionSeguridadFila, type ErrorPostgres } from '../errores/errores-postgres.js';

const MENSAJE_GENERICO = 'Ocurrió un error inesperado. Intente de nuevo más tarde.';

interface RespuestaError {
  status: number;
  cuerpo: { statusCode: number; message: string | string[]; requestId: string; [campoExtra: string]: unknown };
  /** Si está presente, se registra en el log del servidor (nunca en la respuesta). */
  logNivel?: 'warn' | 'error';
  logDetalle?: string;
}

/**
 * Único lugar del backend que traduce un error a una respuesta HTTP.
 * Los servicios lanzan errores de dominio (src/comun/errores) o dejan
 * propagar el error crudo de Postgres; este filtro decide el código HTTP,
 * arma un cuerpo seguro para el cliente y registra el detalle en el log.
 *
 * Nunca debe llegar al cliente: stack trace, texto SQL, nombres de tablas o
 * columnas, ni el cuerpo de la petición.
 */
@Catch()
export class ExcepcionesFilter implements ExceptionFilter {
  private readonly logger = new Logger('Excepciones');

  catch(excepcion: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();
    const requestId = req.requestId ?? 'sin-id';

    const { status, cuerpo, logNivel, logDetalle } = this.traducir(excepcion, requestId);

    if (logNivel) {
      const contexto = `[${requestId}] ${req.method} ${req.originalUrl ?? req.url} usuario=${req.usuario?.id ?? 'anonimo'}`;
      if (logNivel === 'error') {
        this.logger.error(`${contexto} -> ${status}${logDetalle ? `: ${logDetalle}` : ''}`);
      } else {
        this.logger.warn(`${contexto} -> ${status}${logDetalle ? `: ${logDetalle}` : ''}`);
      }
    }

    res.status(status).json(cuerpo);
  }

  private traducir(excepcion: unknown, requestId: string): RespuestaError {
    if (excepcion instanceof NoEncontradoError) {
      return this.respuesta(HttpStatus.NOT_FOUND, excepcion.message, requestId, 'warn');
    }
    if (excepcion instanceof ConflictoError) {
      return this.respuesta(HttpStatus.CONFLICT, excepcion.message, requestId, 'warn');
    }
    if (excepcion instanceof ReglaNegocioError) {
      return this.respuesta(HttpStatus.BAD_REQUEST, excepcion.message, requestId, 'warn');
    }
    if (excepcion instanceof PermisoError) {
      return this.respuesta(HttpStatus.FORBIDDEN, excepcion.message, requestId, 'warn');
    }
    if (excepcion instanceof NoAutorizadoError) {
      return this.respuesta(HttpStatus.UNAUTHORIZED, excepcion.message, requestId, 'warn');
    }

    if (excepcion instanceof HttpException) {
      const status = excepcion.getStatus();
      const cuerpoOriginal = excepcion.getResponse();
      const logNivel = status >= 500 ? 'error' : 'warn';
      if (typeof cuerpoOriginal === 'string') {
        return this.respuesta(status, cuerpoOriginal, requestId, logNivel);
      }
      // Se conservan campos extra del cuerpo (ej. `estado` de EstadoSesionGuard):
      // solo los pone ahí nuestro propio código, nunca datos de la petición del cliente.
      const { message, ...extra } = cuerpoOriginal as Record<string, unknown> & { message?: string | string[] };
      return {
        status,
        cuerpo: { statusCode: status, message: message ?? excepcion.message, requestId, ...extra },
        logNivel,
      };
    }

    if (esErrorPostgres(excepcion)) {
      return this.traducirPostgres(excepcion, requestId);
    }

    // Errores de middleware de Express que no pasan por Nest (ej. body-parser
    // rechazando un JSON mal formado o un cuerpo de más de 100kb): traen su
    // propio status/statusCode y un mensaje seguro de mostrar.
    const middleware = this.comoErrorDeMiddleware(excepcion);
    if (middleware) {
      return this.respuesta(middleware.status, middleware.message, requestId, middleware.status >= 500 ? 'error' : 'warn');
    }

    return this.respuesta(
      HttpStatus.INTERNAL_SERVER_ERROR,
      MENSAJE_GENERICO,
      requestId,
      'error',
      excepcion instanceof Error ? (excepcion.stack ?? excepcion.message) : String(excepcion),
    );
  }

  private traducirPostgres(error: ErrorPostgres, requestId: string): RespuestaError {
    const detalleLog = `pg:${error.code} ${error.constraint ? `constraint=${error.constraint}` : ''} ${error.message ?? ''}`.trim();

    if (error.code === '23505') {
      return this.respuesta(HttpStatus.CONFLICT, 'El registro ya existe', requestId, 'warn', detalleLog);
    }
    if (error.code === '23503' || error.code === '23514') {
      return this.respuesta(
        HttpStatus.BAD_REQUEST,
        'La operación no cumple una regla de la base de datos',
        requestId,
        'warn',
        detalleLog,
      );
    }
    if (error.code === 'P0001') {
      return this.respuesta(
        HttpStatus.BAD_REQUEST,
        error.message ?? 'Regla de negocio no permitida',
        requestId,
        'warn',
        detalleLog,
      );
    }
    if (esViolacionSeguridadFila(error)) {
      return this.respuesta(HttpStatus.FORBIDDEN, 'No tiene permiso para esta operación', requestId, 'warn', detalleLog);
    }
    if (error.code === '57014') {
      return this.respuesta(
        HttpStatus.SERVICE_UNAVAILABLE,
        'El servidor tardó demasiado en responder. Intente de nuevo.',
        requestId,
        'error',
        detalleLog,
      );
    }

    return this.respuesta(HttpStatus.INTERNAL_SERVER_ERROR, MENSAJE_GENERICO, requestId, 'error', detalleLog);
  }

  /**
   * Reconoce errores de middleware de Express (body-parser, etc.) que traen
   * un `status`/`statusCode` HTTP válido y un mensaje seguro, sin ser
   * instancias de HttpException ni errores de Postgres.
   */
  private comoErrorDeMiddleware(excepcion: unknown): { status: number; message: string } | null {
    if (typeof excepcion !== 'object' || excepcion === null) return null;
    const posible = excepcion as { status?: unknown; statusCode?: unknown; message?: unknown };
    const status = posible.status ?? posible.statusCode;
    if (typeof status !== 'number' || status < 400 || status > 599) return null;
    return { status, message: typeof posible.message === 'string' ? posible.message : MENSAJE_GENERICO };
  }

  private respuesta(
    status: number,
    message: string | string[],
    requestId: string,
    logNivel?: 'warn' | 'error',
    logDetalle?: string,
  ): RespuestaError {
    return { status, cuerpo: { statusCode: status, message, requestId }, logNivel, logDetalle };
  }
}
