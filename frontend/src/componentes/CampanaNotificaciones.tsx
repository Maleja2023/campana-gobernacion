import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { api, type Notificacion } from '../api/cliente';
import { Icono } from './Icono';

const hace = (v: string) => {
  const min = Math.round((Date.now() - new Date(v).getTime()) / 60_000);
  if (min < 1) return 'ahora';
  if (min < 60) return `hace ${min} min`;
  if (min < 24 * 60) return `hace ${Math.round(min / 60)} h`;
  return new Date(v).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
};

/** Campana del encabezado: notificaciones internas del usuario. */
export function CampanaNotificaciones() {
  const cache = useQueryClient();
  const navigate = useNavigate();
  const [abierta, setAbierta] = useState(false);
  const caja = useRef<HTMLDivElement>(null);
  const q = useQuery({ queryKey: ['notificaciones'], queryFn: api.notificaciones, refetchInterval: 60_000, refetchIntervalInBackground: false });
  const noLeidas = q.data?.noLeidas ?? 0;

  useEffect(() => {
    if (!abierta) return;
    const cerrar = (e: MouseEvent) => {
      if (caja.current && !caja.current.contains(e.target as Node)) setAbierta(false);
    };
    const escape = (e: KeyboardEvent) => e.key === 'Escape' && setAbierta(false);
    document.addEventListener('mousedown', cerrar);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', cerrar);
      document.removeEventListener('keydown', escape);
    };
  }, [abierta]);

  async function leer(ids?: string[]) {
    await api.leerNotificaciones(ids).catch(() => undefined);
    void cache.invalidateQueries({ queryKey: ['notificaciones'] });
  }

  function abrir(n: Notificacion) {
    if (!n.leida_en) void leer([n.id]);
    setAbierta(false);
    if (n.enlace?.startsWith('/')) navigate(n.enlace);
  }

  return (
    <div className="campana" ref={caja}>
      <button type="button" onClick={() => setAbierta(!abierta)} aria-expanded={abierta} title="Notificaciones" aria-label={`Notificaciones${noLeidas ? `: ${noLeidas} sin leer` : ''}`}>
        <Icono nombre="campana" tamano={17} />
        {noLeidas > 0 && <span className="campana-contador">{noLeidas > 99 ? '99+' : noLeidas}</span>}
      </button>
      {abierta && (
        <div className="campana-panel" role="dialog" aria-label="Notificaciones">
          <div className="campana-cabecera">
            <strong>Notificaciones</strong>
            {noLeidas > 0 && (
              <button type="button" className="link-button" onClick={() => void leer()}>
                Marcar todas como leídas
              </button>
            )}
          </div>
          {q.data?.datos.length === 0 && <p className="empty-inline">No tienes notificaciones.</p>}
          <ul>
            {q.data?.datos.map((n) => (
              <li key={n.id} className={n.leida_en ? '' : 'no-leida'}>
                <button type="button" onClick={() => abrir(n)}>
                  <strong>{n.titulo}</strong>
                  <span>{n.cuerpo}</span>
                  <small>{hace(n.creada_en)}</small>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
