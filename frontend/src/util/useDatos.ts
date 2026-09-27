import { useCallback, useEffect, useRef, useState } from 'react';

export interface EstadoDatos<T> {
  datos: T | undefined;
  cargando: boolean;
  error: string | null;
  recargar: () => void;
}

/** Carga datos de la API y descarta respuestas viejas si cambian las dependencias. */
export function useDatos<T>(cargar: () => Promise<T>, dependencias: unknown[]): EstadoDatos<T> {
  const [datos, setDatos] = useState<T>();
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const cargarRef = useRef(cargar);
  cargarRef.current = cargar;

  useEffect(() => {
    let vigente = true;
    setCargando(true);
    setError(null);
    cargarRef
      .current()
      .then((resultado) => {
        if (vigente) setDatos(resultado);
      })
      .catch((e: unknown) => {
        if (vigente) setError(e instanceof Error ? e.message : 'Ocurrió un error inesperado.');
      })
      .finally(() => {
        if (vigente) setCargando(false);
      });
    return () => {
      vigente = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...dependencias, version]);

  const recargar = useCallback(() => setVersion((v) => v + 1), []);
  return { datos, cargando, error, recargar };
}
