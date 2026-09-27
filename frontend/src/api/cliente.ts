const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '/api';
const CLAVE_TOKEN = 'campana.token';

export class ErrorApi extends Error {
  readonly estado: number;
  constructor(estado: number, mensaje: string) {
    super(mensaje);
    this.estado = estado;
  }
}

let alExpirar: (() => void) | null = null;

/** La sesión se registra aquí para enterarse cuando la API responde 401. */
export function alExpirarSesion(fn: () => void) {
  alExpirar = fn;
}

export function leerToken(): string | null {
  try {
    return sessionStorage.getItem(CLAVE_TOKEN);
  } catch {
    return null;
  }
}

export function guardarToken(token: string | null) {
  try {
    if (token) sessionStorage.setItem(CLAVE_TOKEN, token);
    else sessionStorage.removeItem(CLAVE_TOKEN);
  } catch {
    /* almacenamiento bloqueado: la sesión dura lo que dure la pestaña */
  }
}

type Parametros = Record<string, string | number | undefined | null>;

function construirUrl(ruta: string, parametros?: Parametros) {
  const url = `${BASE}${ruta}`;
  if (!parametros) return url;
  const busqueda = new URLSearchParams();
  for (const [clave, valor] of Object.entries(parametros)) {
    if (valor !== undefined && valor !== null && valor !== '') busqueda.set(clave, String(valor));
  }
  const texto = busqueda.toString();
  return texto ? `${url}?${texto}` : url;
}

async function pedir<T>(metodo: string, ruta: string, opciones: { parametros?: Parametros; cuerpo?: unknown } = {}): Promise<T> {
  const token = leerToken();
  const respuesta = await fetch(construirUrl(ruta, opciones.parametros), {
    method: metodo,
    headers: {
      ...(opciones.cuerpo !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: opciones.cuerpo !== undefined ? JSON.stringify(opciones.cuerpo) : undefined,
  }).catch(() => {
    throw new ErrorApi(0, 'No hay conexión con el servidor. Verifique su red e intente de nuevo.');
  });

  if (respuesta.status === 401 && token) {
    guardarToken(null);
    alExpirar?.();
  }
  if (!respuesta.ok) {
    let mensaje = 'Ocurrió un error inesperado.';
    try {
      const cuerpo = (await respuesta.json()) as { message?: string | string[] };
      if (Array.isArray(cuerpo.message)) mensaje = cuerpo.message.join('. ');
      else if (cuerpo.message) mensaje = cuerpo.message;
    } catch {
      /* respuesta sin cuerpo */
    }
    if (respuesta.status === 429) mensaje = 'Demasiados intentos. Espere un minuto e intente de nuevo.';
    if (respuesta.status === 403) mensaje = 'No tiene permiso para ver esta información.';
    throw new ErrorApi(respuesta.status, mensaje);
  }
  if (respuesta.status === 204) return undefined as T;
  return (await respuesta.json()) as T;
}

export const api = {
  get: <T>(ruta: string, parametros?: Parametros) => pedir<T>('GET', ruta, { parametros }),
  post: <T>(ruta: string, cuerpo?: unknown) => pedir<T>('POST', ruta, { cuerpo: cuerpo ?? {} }),
  patch: <T>(ruta: string, cuerpo: unknown) => pedir<T>('PATCH', ruta, { cuerpo }),
};
