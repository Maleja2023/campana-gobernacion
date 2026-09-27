import { api, ApiError } from '../api/cliente';
import { borrar, cifrar, descifrar, guardar, leerPorUsuario, type Cifrado } from './almacen';

/** Cuerpo de POST /simpatizantes tal como se envía (incluye capturadoEn). */
export type CuerpoRegistro = Record<string, unknown> & { nombres: string; apellidos: string; capturadoEn: string };

type Guardado = {
  id: string;
  usuarioId: string;
  creadoEn: string;
  /** Mensaje de la API si el envío fue rechazado (no se reintenta solo). */
  error?: string;
  cifrado: Cifrado;
};

export type Pendiente = { id: string; creadoEn: string; nombre: string; error?: string };

export type ResultadoSincronizacion = { enviados: number; duplicados: number; rechazados: number; sinConexion: boolean; requiereSesion: boolean };

const eventos = new EventTarget();
const avisarCambio = () => eventos.dispatchEvent(new Event('cambio'));

export function alCambiarPendientes(fn: () => void): () => void {
  eventos.addEventListener('cambio', fn);
  return () => eventos.removeEventListener('cambio', fn);
}

export async function agregarPendiente(usuarioId: string, cuerpo: CuerpoRegistro): Promise<void> {
  const registro: Guardado = { id: crypto.randomUUID(), usuarioId, creadoEn: cuerpo.capturadoEn, cifrado: await cifrar(cuerpo) };
  await guardar('pendientes', registro);
  avisarCambio();
}

export async function listarPendientes(usuarioId: string): Promise<Pendiente[]> {
  const guardados = await leerPorUsuario<Guardado>(usuarioId);
  const lista = await Promise.all(
    guardados.map(async (g) => {
      const cuerpo = await descifrar<CuerpoRegistro>(g.cifrado);
      return { id: g.id, creadoEn: g.creadoEn, nombre: `${cuerpo.nombres} ${cuerpo.apellidos}`, error: g.error };
    }),
  );
  return lista.sort((a, b) => a.creadoEn.localeCompare(b.creadoEn));
}

export async function descartarPendiente(id: string): Promise<void> {
  await borrar('pendientes', id);
  avisarCambio();
}

let enCurso: Promise<ResultadoSincronizacion> | null = null;
let ultimo: ResultadoSincronizacion | null = null;

/** Resultado del último envío (lo muestre la pantalla que lo muestre). */
export function ultimoEnvio(): ResultadoSincronizacion | null {
  return ultimo;
}

/**
 * Envía los pendientes del usuario, del más antiguo al más nuevo.
 * - Enviado o ya registrado (409): se borra del celular.
 * - Rechazado por la API (datos inválidos, líder fuera de alcance, más de 30
 *   días...): queda con el mensaje, para corregir o descartar a mano.
 * - Sin conexión o sesión vencida: se detiene y se reintenta después.
 */
export function sincronizar(usuarioId: string): Promise<ResultadoSincronizacion> {
  if (!enCurso) {
    enCurso = (async () => {
      const r: ResultadoSincronizacion = { enviados: 0, duplicados: 0, rechazados: 0, sinConexion: false, requiereSesion: false };
      const guardados = (await leerPorUsuario<Guardado>(usuarioId)).filter((g) => !g.error).sort((a, b) => a.creadoEn.localeCompare(b.creadoEn));
      for (const g of guardados) {
        const cuerpo = await descifrar<CuerpoRegistro>(g.cifrado);
        try {
          await api.registroInterno(cuerpo);
          await borrar('pendientes', g.id);
          r.enviados++;
        } catch (causa) {
          if (causa instanceof ApiError && causa.status === 409) {
            await borrar('pendientes', g.id);
            r.duplicados++;
          } else if (causa instanceof ApiError && causa.status === 401) {
            r.requiereSesion = true;
            break;
          } else if (causa instanceof ApiError && causa.status >= 400 && causa.status < 500 && causa.status !== 429) {
            await guardar('pendientes', { ...g, error: causa.message });
            r.rechazados++;
          } else {
            // Sin red, servidor caído o demasiadas solicitudes: se reintenta después.
            r.sinConexion = true;
            break;
          }
        }
        avisarCambio();
      }
      if (r.enviados + r.duplicados + r.rechazados > 0 || r.requiereSesion) ultimo = r;
      avisarCambio();
      return r;
    })().finally(() => {
      enCurso = null;
    });
  }
  return enCurso;
}

/** true si el error viene de no poder hablar con el servidor (sin señal). */
export function esErrorDeConexion(causa: unknown): boolean {
  return !(causa instanceof ApiError) || causa.status === 0 || causa.status >= 502;
}
