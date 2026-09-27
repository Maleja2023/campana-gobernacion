import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError, configurarCierreDeSesion, type LoginResponse, type Usuario } from '../api/cliente';

// Cierre de sesión por inactividad: 30 min sin actividad, con aviso 1 min antes.
const INACTIVIDAD_LIMITE_MS = 30 * 60 * 1000;
const INACTIVIDAD_AVISO_MS = 60 * 1000;
const EVENTOS_ACTIVIDAD = ['mousedown', 'mousemove', 'keydown', 'touchstart', 'scroll'] as const;

// Para abrir la app sin señal (registro en veredas): se guarda el perfil (nombre,
// roles, permisos; nunca tokens ni datos de simpatizantes) y la hora de la
// última actividad. Sin conexión solo se reabre si esa actividad fue hace
// menos de INACTIVIDAD_LIMITE_MS: la misma regla del cierre por inactividad.
const CLAVE_PERFIL = 'campana.perfil';
const CLAVE_ACTIVIDAD = 'campana.actividad';

function guardarPerfilLocal(usuario: Usuario) {
  try {
    localStorage.setItem(CLAVE_PERFIL, JSON.stringify(usuario));
    localStorage.setItem(CLAVE_ACTIVIDAD, String(Date.now()));
  } catch { /* almacenamiento bloqueado: la app solo funcionará en línea */ }
}

function perfilLocalVigente(): Usuario | null {
  try {
    const perfil = localStorage.getItem(CLAVE_PERFIL);
    const actividad = Number(localStorage.getItem(CLAVE_ACTIVIDAD) ?? 0);
    if (!perfil || Date.now() - actividad > INACTIVIDAD_LIMITE_MS) return null;
    const usuario = JSON.parse(perfil) as Usuario;
    return usuario.estado === 'LISTO' ? usuario : null;
  } catch {
    return null;
  }
}

function borrarPerfilLocal() {
  try {
    localStorage.removeItem(CLAVE_PERFIL);
    localStorage.removeItem(CLAVE_ACTIVIDAD);
  } catch { /* nada que borrar */ }
}

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
  // Los registros guardados sin conexión NO se borran: están cifrados y
  // atados al usuario, y se envían en su próximo ingreso.
  const limpiarRastroDeSesion = () => {
    sessionStorage.clear();
    borrarPerfilLocal();
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
    try {
      const perfil = await api.perfil();
      setUsuario(perfil);
      setError(null);
      if (perfil.estado === 'LISTO') guardarPerfilLocal(perfil);
    } catch (causa) {
      // Sin red (no es una respuesta de la API): se usa el perfil guardado si sigue vigente.
      const sinConexion = !(causa instanceof ApiError);
      setUsuario(sinConexion ? perfilLocalVigente() : null);
      if (!sinConexion) borrarPerfilLocal();
    }
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
    let ultimaEscritura = 0;
    const reiniciarTemporizadores = () => {
      setAvisoInactividad(false);
      if (Date.now() - ultimaEscritura > 15_000) {
        ultimaEscritura = Date.now();
        try { localStorage.setItem(CLAVE_ACTIVIDAD, String(ultimaEscritura)); } catch { /* sin almacenamiento */ }
      }
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
