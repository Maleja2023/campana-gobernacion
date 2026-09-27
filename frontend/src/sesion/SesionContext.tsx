import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, configurarCierreDeSesion, type LoginResponse, type Usuario } from '../api/cliente';

// Cierre de sesión por inactividad: 30 min sin actividad, con aviso 1 min antes.
const INACTIVIDAD_LIMITE_MS = 30 * 60 * 1000;
const INACTIVIDAD_AVISO_MS = 60 * 1000;
const EVENTOS_ACTIVIDAD = ['mousedown', 'mousemove', 'keydown', 'touchstart', 'scroll'] as const;

type SesionContextValue = { usuario: Usuario | null; cargando: boolean; error: string | null; avisoInactividad: boolean; iniciar: (login: string, clave: string) => Promise<LoginResponse>; cerrar: () => Promise<void>; tienePermiso: (codigo: string) => boolean; refrescar: () => Promise<void> };
const SesionContext = createContext<SesionContextValue | null>(null);

export function SesionProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [avisoInactividad, setAvisoInactividad] = useState(false);
  const queryClient = useQueryClient();

  // Nunca dejar en el navegador nada de la sesión anterior (ni caché de
  // datos) al cerrar sesión, sea por acción del usuario, por inactividad o
  // porque la API respondió 401. La sesión misma vive en cookies httpOnly:
  // el navegador las maneja, aquí no hay ningún token que guardar ni borrar.
  const limpiarRastroDeSesion = () => {
    sessionStorage.clear();
    queryClient.clear();
    setUsuario(null);
    setAvisoInactividad(false);
  };

  const cerrar = async () => {
    try { await api.salir(); } catch { /* la sesión puede haber expirado ya */ }
    limpiarRastroDeSesion();
  };
  configurarCierreDeSesion(() => { limpiarRastroDeSesion(); window.location.assign('/login'); });

  // Al cargar la app no hay forma de leer la cookie httpOnly desde JS: se
  // pregunta siempre a la API. Un 401 aquí solo significa "no hay sesión
  // todavía" (visitante nuevo), no un error que mostrar.
  const refrescar = async () => {
    try { setUsuario(await api.perfil()); setError(null); }
    catch { setUsuario(null); }
    finally { setCargando(false); }
  };
  useEffect(() => { void refrescar(); }, []);

  const iniciar = async (login: string, clave: string) => {
    const response = await api.iniciarSesion(login, clave);
    await refrescar();
    return response;
  };

  useEffect(() => {
    if (!usuario) return;
    let avisoId: ReturnType<typeof setTimeout>;
    let cierreId: ReturnType<typeof setTimeout>;
    const reiniciarTemporizadores = () => {
      setAvisoInactividad(false);
      clearTimeout(avisoId);
      clearTimeout(cierreId);
      avisoId = setTimeout(() => setAvisoInactividad(true), INACTIVIDAD_LIMITE_MS - INACTIVIDAD_AVISO_MS);
      cierreId = setTimeout(() => { void cerrar(); }, INACTIVIDAD_LIMITE_MS);
    };
    reiniciarTemporizadores();
    EVENTOS_ACTIVIDAD.forEach((evento) => window.addEventListener(evento, reiniciarTemporizadores, { passive: true }));
    return () => {
      clearTimeout(avisoId);
      clearTimeout(cierreId);
      EVENTOS_ACTIVIDAD.forEach((evento) => window.removeEventListener(evento, reiniciarTemporizadores));
    };
    // Solo depende de `usuario`: entrar/salir de sesión es lo único que
    // debe reiniciar por completo este efecto (cerrar() no cambia con cada
    // render de forma que importe aquí).
  }, [usuario]);

  const value = useMemo(() => ({ usuario, cargando, error, avisoInactividad, iniciar, cerrar, tienePermiso: (codigo: string) => usuario?.permisos.includes(codigo) ?? false, refrescar }), [usuario, cargando, error, avisoInactividad]);
  return <SesionContext.Provider value={value}>{children}</SesionContext.Provider>;
}

export function useSesion() { const value = useContext(SesionContext); if (!value) throw new Error('useSesion debe usarse dentro de SesionProvider'); return value; }
