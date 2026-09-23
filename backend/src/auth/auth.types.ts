/** Usuario autenticado que viaja en cada petición. */
export interface UsuarioSesion {
  id: string;
  login: string;
  sesionId: string;
}

/** Contenido del token JWT. */
export interface TokenPayload {
  sub: string;   // id del usuario
  sid: string;   // id de la sesión (permite cerrarla)
  login: string;
}

declare module 'express' {
  interface Request {
    usuario?: UsuarioSesion;
  }
}
