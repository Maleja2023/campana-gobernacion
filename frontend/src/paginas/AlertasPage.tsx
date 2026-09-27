import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Alerta } from '../api/cliente';
import { Cargando, ErrorEstado } from '../componentes/Estados';

const SEVERIDAD_ETIQUETA: Record<string, string> = { ALTA: 'Alta', MEDIA: 'Media', BAJA: 'Baja' };
const ESTADO_ETIQUETA: Record<string, string> = { ABIERTA: 'Abierta', EN_REVISION: 'En revisión', RESUELTA: 'Resuelta', DESCARTADA: 'Descartada' };

const FILTROS: { valor: string; etiqueta: string }[] = [
  { valor: '', etiqueta: 'Abiertas' },
  { valor: 'RESUELTA', etiqueta: 'Resueltas' },
  { valor: 'DESCARTADA', etiqueta: 'Descartadas' },
];

function formatFecha(v: string | null) {
  if (!v) return '—';
  return new Date(v).toLocaleString('es-CO', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function AlertasPage() {
  const cache = useQueryClient();
  const [filtro, setFiltro] = useState('');
  const [abierta, setAbierta] = useState<string>();

  const alertas = useQuery({ queryKey: ['alertas', filtro], queryFn: () => api.alertas(filtro || undefined) });

  async function refrescar() {
    await Promise.all([cache.invalidateQueries({ queryKey: ['alertas'] }), cache.invalidateQueries({ queryKey: ['tablero', 'indicadores'] })]);
  }

  return (
    <main className="page-content alertas-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Calidad de datos</p>
          <h1>Alertas</h1>
        </div>
      </div>

      <nav className="agenda-tabs" aria-label="Filtrar alertas">
        {FILTROS.map((f) => (
          <button key={f.valor} type="button" className={filtro === f.valor ? 'active' : ''} onClick={() => setFiltro(f.valor)}>
            {f.etiqueta}
          </button>
        ))}
      </nav>

      {alertas.isPending && <Cargando texto="Cargando alertas..." />}
      {alertas.isError && <ErrorEstado mensaje={alertas.error.message} reintentar={() => void alertas.refetch()} />}
      {alertas.data && (
        <div className="alertas-list">
          {alertas.data.length === 0 && <p className="dashboard-subtitle">No hay alertas en este estado.</p>}
          {alertas.data.map((a) => (
            <AlertaCard
              key={a.id}
              alerta={a}
              abierta={abierta === a.id}
              onToggle={() => setAbierta(abierta === a.id ? undefined : a.id)}
              onResuelta={refrescar}
            />
          ))}
        </div>
      )}
    </main>
  );
}

function AlertaCard({
  alerta,
  abierta,
  onToggle,
  onResuelta,
}: {
  alerta: Alerta;
  abierta: boolean;
  onToggle: () => void;
  onResuelta: () => Promise<void>;
}) {
  const detalle = useQuery({ queryKey: ['alerta-detalle', alerta.id], queryFn: () => api.alertaDetalle(alerta.id), enabled: abierta });
  const [observacion, setObservacion] = useState('');
  const [guardando, setGuardando] = useState<'RESUELTA' | 'DESCARTADA'>();
  const [error, setError] = useState('');
  const resuelta = alerta.estado === 'RESUELTA' || alerta.estado === 'DESCARTADA';

  async function resolver(estado: 'RESUELTA' | 'DESCARTADA') {
    const nota = observacion.trim();
    if (nota.length < 3) {
      setError('Escribe una observación de al menos 3 caracteres antes de cerrar la alerta.');
      return;
    }
    setError('');
    setGuardando(estado);
    try {
      await api.resolverAlerta(alerta.id, { estado, observacion: nota });
      await onResuelta();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No fue posible actualizar la alerta.');
    } finally {
      setGuardando(undefined);
    }
  }

  return (
    <article className={`alerta-card severidad-${alerta.severidad.toLowerCase()}`}>
      <button type="button" className="alerta-card-head" onClick={onToggle} aria-expanded={abierta} aria-controls={`alerta-body-${alerta.id}`}>
        <div>
          <span className={`estado-pill severidad-${alerta.severidad.toLowerCase()}`}>{SEVERIDAD_ETIQUETA[alerta.severidad] ?? alerta.severidad}</span>
          <h2>{alerta.tipo_descripcion}</h2>
          <small>
            {alerta.personas} persona{alerta.personas === 1 ? '' : 's'} · {alerta.miembros} líder{alerta.miembros === 1 ? '' : 'es'} involucrados
          </small>
        </div>
        <div className="alerta-card-meta">
          <span>{formatFecha(alerta.detectada_en)}</span>
          <span className={`estado-pill estado-${alerta.estado.toLowerCase()}`}>{ESTADO_ETIQUETA[alerta.estado] ?? alerta.estado}</span>
        </div>
      </button>
      {abierta && (
        <div className="alerta-card-body" id={`alerta-body-${alerta.id}`}>
          {detalle.isPending && <Cargando texto="Cargando detalle..." />}
          {detalle.isError && <ErrorEstado mensaje={detalle.error.message} reintentar={() => void detalle.refetch()} />}
          {detalle.data && (
            <>
              {detalle.data.personas.length > 0 && (
                <div>
                  <h3>Personas involucradas</h3>
                  <ul>
                    {detalle.data.personas.map((p) => (
                      <li key={p.id}>
                        <strong>
                          {p.nombres} {p.apellidos}
                        </strong>
                        <small>
                          {p.zona ?? 'Sin zona registrada'}
                          {p.referido_por ? ` · Referido por ${p.referido_por}` : ''}
                        </small>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {detalle.data.miembros.length > 0 && (
                <div>
                  <h3>Líderes involucrados</h3>
                  <ul>
                    {detalle.data.miembros.map((m) => (
                      <li key={m.id}>
                        <strong>
                          {m.nombres} {m.apellidos} · {m.cargo_codigo}
                        </strong>
                        <small>
                          {m.zona ?? 'Sin zona asignada'}
                          {m.referido_por ? ` · Superior: ${m.referido_por}` : ''}
                        </small>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
          {alerta.observacion && (
            <p className="alerta-observacion">
              <strong>Observación:</strong> {alerta.observacion}
            </p>
          )}
          {resuelta ? (
            <p className="alerta-observacion">
              <strong>{ESTADO_ETIQUETA[alerta.estado] ?? alerta.estado}</strong> el {formatFecha(alerta.resuelta_en)}.
            </p>
          ) : (
            <div className="alerta-resolver">
              <label>
                Observación <span className="optional">obligatoria para cerrar la alerta</span>
                <textarea value={observacion} onChange={(e) => setObservacion(e.target.value)} rows={2} maxLength={500} />
              </label>
              {error && (
                <div className="form-error" role="alert">
                  {error}
                </div>
              )}
              <div className="form-actions">
                <button type="button" className="primary-button" disabled={!!guardando} onClick={() => void resolver('RESUELTA')}>
                  {guardando === 'RESUELTA' ? 'Guardando...' : 'Marcar resuelta'}
                </button>
                <button type="button" className="secondary-button" disabled={!!guardando} onClick={() => void resolver('DESCARTADA')}>
                  {guardando === 'DESCARTADA' ? 'Guardando...' : 'Descartar'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
