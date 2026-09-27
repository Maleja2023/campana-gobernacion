import type { Response } from 'express';

export const COOKIE_ACCESO = 'campana_acceso';
export const COOKIE_RENOVACION = 'campana_renovacion';

/** Duración fija del token de acceso: corto a propósito, se renueva con la cookie de renovación. */
export const DURACION_ACCESO = '15m';
const DURACION_ACCESO_MS = 15 * 60 * 1000;

interface OpcionesCookie {
  cookieSegura: boolean;
}

export function establecerCookieAcceso(res: Response, token: string, { cookieSegura }: OpcionesCookie): void {
  res.cookie(COOKIE_ACCESO, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: cookieSegura,
    path: '/api',
    maxAge: DURACION_ACCESO_MS,
  });
}

export function establecerCookieRenovacion(
  res: Response,
  token: string,
  { cookieSegura, horas }: OpcionesCookie & { horas: number },
): void {
  res.cookie(COOKIE_RENOVACION, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: cookieSegura,
    path: '/api/auth',
    maxAge: horas * 60 * 60 * 1000,
  });
}

/** Borra ambas cookies de sesión. Las opciones deben calzar con las de creación o el navegador no las borra. */
export function borrarCookiesSesion(res: Response, { cookieSegura }: OpcionesCookie): void {
  res.clearCookie(COOKIE_ACCESO, { httpOnly: true, sameSite: 'strict', secure: cookieSegura, path: '/api' });
  res.clearCookie(COOKIE_RENOVACION, { httpOnly: true, sameSite: 'strict', secure: cookieSegura, path: '/api/auth' });
}
