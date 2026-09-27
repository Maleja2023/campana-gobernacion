import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/cliente';
import { Cargando } from '../componentes/Estados';
import { Icono } from '../componentes/Icono';

/** Enlace "no más mensajes" de cada SMS o correo: /baja/<token>. */
export function BajaPage() {
  const { token = '' } = useParams();
  const info = useQuery({ queryKey: ['baja', token], queryFn: () => api.consultarBaja(token), retry: false });
  const [listo, setListo] = useState<string>();
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function confirmar() {
    setEnviando(true);
    setError('');
    try {
      setListo((await api.confirmarBaja(token)).mensaje);
    } catch (causa) {
      setError(causa instanceof Error ? causa.message : 'No se pudo procesar la solicitud.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <main className="publica-page">
      <article className="publica-card">
        <header className="publica-encabezado">
          <span className="brand-mark">
            <Icono nombre="mensaje" tamano={19} />
          </span>
          <div>
            <p className="eyebrow">Mensajes de la campaña</p>
            <h1>No recibir más mensajes</h1>
          </div>
        </header>
        {info.isPending && <Cargando />}
        {info.isError && <div className="form-error">{info.error.message}</div>}
        {listo && (
          <div className="publica-exito">
            <Icono nombre="check" tamano={22} />
            <div>
              <strong>{listo}</strong>
              <p>Si cambias de opinión o quieres dejar de recibir mensajes por otros medios, usa la página Mis datos.</p>
            </div>
          </div>
        )}
        {info.data && !listo && (
          <div className="publica-form">
            <p>
              Vas a dejar de recibir <strong>{info.data.descripcion}</strong> de la campaña. Queda aplicado de inmediato, incluso en envíos que ya estaban
              programados.
            </p>
            {error && <div className="form-error">{error}</div>}
            <button type="button" className="primary-button" disabled={enviando} onClick={() => void confirmar()}>
              {enviando ? 'Procesando...' : 'Sí, no quiero recibir más'}
            </button>
          </div>
        )}
        <p className="helper publica-pie">
          <Link to="/mis-datos">Mis datos</Link> · <Link to="/privacidad">Política de tratamiento de datos</Link>
        </p>
      </article>
    </main>
  );
}
