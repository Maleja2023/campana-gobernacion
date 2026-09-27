/**
 * Errores de dominio: los servicios los lanzan en vez de excepciones HTTP de
 * Nest. El único lugar que los traduce a un código HTTP es
 * `ExcepcionesFilter` (src/comun/filtros/excepciones.filter.ts).
 */
export abstract class ErrorDominio extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** El recurso solicitado no existe o no es visible para el usuario (-> 404). */
export class NoEncontradoError extends ErrorDominio {}

/** La operación choca con el estado actual de los datos (-> 409). */
export class ConflictoError extends ErrorDominio {}

/** El dato o la operación viola una regla de negocio (-> 400). */
export class ReglaNegocioError extends ErrorDominio {}

/** El usuario no tiene permiso para hacer esto, aunque esté autenticado (-> 403). */
export class PermisoError extends ErrorDominio {}

/** Falló la autenticación (credenciales, sesión, token) (-> 401). */
export class NoAutorizadoError extends ErrorDominio {}
