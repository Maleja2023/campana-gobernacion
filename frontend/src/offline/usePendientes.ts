import { useCallback, useEffect, useState } from 'react';
import { alCambiarPendientes, listarPendientes, sincronizar, ultimoEnvio, type Pendiente, type ResultadoSincronizacion } from './cola';

const REINTENTO_MS = 60_000;

/** Registros guardados en el celular para el usuario, y su envío. */
export function usePendientes(usuarioId: string | undefined, { enviarSolo = false } = {}) {
  const [pendientes, setPendientes] = useState<Pendiente[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [ultimoResultado, setUltimoResultado] = useState<ResultadoSincronizacion | null>(() => ultimoEnvio());
  const [enLinea, setEnLinea] = useState(() => navigator.onLine);

  const refrescar = useCallback(async () => {
    if (!usuarioId) return;
    setPendientes(await listarPendientes(usuarioId).catch(() => []));
    setUltimoResultado(ultimoEnvio());
  }, [usuarioId]);

  const enviar = useCallback(async () => {
    if (!usuarioId) return null;
    setEnviando(true);
    try {
      return await sincronizar(usuarioId);
    } finally {
      setEnviando(false);
      await refrescar();
    }
  }, [usuarioId, refrescar]);

  useEffect(() => {
    void refrescar();
    return alCambiarPendientes(() => void refrescar());
  }, [refrescar]);

  useEffect(() => {
    const cambiarEstado = () => setEnLinea(navigator.onLine);
    window.addEventListener('online', cambiarEstado);
    window.addEventListener('offline', cambiarEstado);
    return () => {
      window.removeEventListener('online', cambiarEstado);
      window.removeEventListener('offline', cambiarEstado);
    };
  }, []);

  // Envío automático: al volver la señal, al abrir la app y cada minuto mientras haya pendientes.
  const hayParaEnviar = pendientes.some((p) => !p.error);
  useEffect(() => {
    if (!enviarSolo || !usuarioId || !hayParaEnviar || !enLinea) return;
    void enviar();
    const id = window.setInterval(() => void enviar(), REINTENTO_MS);
    return () => window.clearInterval(id);
  }, [enviarSolo, usuarioId, hayParaEnviar, enLinea, enviar]);

  return { pendientes, enviando, enviar, ultimoResultado, enLinea };
}
