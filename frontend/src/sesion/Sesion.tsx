import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { alExpirarSesion, api, guardarToken, leerToken } from '../api/cliente';
import type { Perfil } from '../api/tipos';

interface ValorSesion {
  perfil: Perfil | null;
  iniciando: boolean;
  expirada: boolean;
  entrar: (login: string, clave: string) => Promise<void>;
  salir: () => Promise<void>;
  puede: (permiso: string) => boolean;
}

const ContextoSesion = createContext<ValorSesion | null>(null);

export function ProveedorSesion({ children }: { children: ReactNode }) {
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [iniciando, setIniciando] = useState(() => leerToken() !== null);
  const [expirada, setExpirada] = useState(false);

  useEffect(() => {
    alExpirarSesion(() => {
      setPerfil(null);
      setExpirada(true);
    });
    if (!leerToken()) return;
    api
      .get<Perfil>('/auth/yo')
      .then(setPerfil)
      .catch(() => guardarToken(null))
      .finally(() => setIniciando(false));
  }, []);

  const entrar = useCallback(async (login: string, clave: string) => {
    const { token } = await api.post<{ token: string }>('/auth/login', { login, clave });
    guardarToken(token);
    setPerfil(await api.get<Perfil>('/auth/yo'));
    setExpirada(false);
  }, []);

  const salir = useCallback(async () => {
    try {
      await api.post('/auth/salir');
    } finally {
      guardarToken(null);
      setPerfil(null);
    }
  }, []);

  const puede = useCallback((permiso: string) => perfil?.permisos.includes(permiso) ?? false, [perfil]);

  const valor = useMemo(
    () => ({ perfil, iniciando, expirada, entrar, salir, puede }),
    [perfil, iniciando, expirada, entrar, salir, puede],
  );
  return <ContextoSesion.Provider value={valor}>{children}</ContextoSesion.Provider>;
}

export function useSesion() {
  const valor = useContext(ContextoSesion);
  if (!valor) throw new Error('useSesion debe usarse dentro de ProveedorSesion');
  return valor;
}
