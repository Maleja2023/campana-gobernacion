import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type SolicitudTitular } from '../api/cliente';
import { Cargando, ErrorEstado } from '../componentes/Estados';
import { useSesion } from '../sesion/SesionContext';
import { nombrePropio } from '../util/nombres';

type Tab = 'solicitudes' | 'bitacora';

const fecha = (v: string | null) => (v ? new Date(v.length === 10 ? `${v}T12:00:00` : v).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const fechaHora = (v: string) => new Date(v).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });

export function CumplimientoPage() {
  const { tienePermiso } = useSesion();
  const [tab, setTab] = useState<Tab>('solicitudes');
  return (
    <main className="page-content">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Seguridad y cumplimiento · Ley 1581 de 2012</p>
          <h1>Protección de datos</h1>
          <p className="dashboard-subtitle">
            Solicitudes de los titulares (con su plazo legal) y bitácora de quién consultó, editó o exportó datos. Página pública para los titulares:{' '}
            <a href="/mis-datos" target="_blank" rel="noreferrer">
              /mis-datos
            </a>
            .
          </p>
        </div>
      </div>
      <nav className="agenda-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'solicitudes'} className={tab === 'solicitudes' ? 'active' : ''} onClick={() => setTab('solicitudes')}>
          Solicitudes de titulares
        </button>
        {tienePermiso('USUARIO_GESTIONAR') && (
          <button type="button" role="tab" aria-selected={tab === 'bitacora'} className={tab === 'bitacora' ? 'active' : ''} onClick={() => setTab('bitacora')}>
            Bitácora de auditoría
          </button>
        )}
      </nav>
      {tab === 'solicitudes' && <Solicitudes />}
      {tab === 'bitacora' && <Bitacora />}
    </main>
  );
}

const ACCIONES: Record<SolicitudTitular['tipo_codigo'], { accion: string; etiqueta: string; peligro?: boolean }[]> = {
  CONSULTA: [{ accion: 'RESPONDER', etiqueta: 'Marcar como respondida' }],
  ACTUALIZACION: [{ accion: 'RESPONDER', etiqueta: 'Datos actualizados: marcar respondida' }],
  SUPRESION: [{ accion: 'SUPRIMIR', etiqueta: 'Eliminar sus datos', peligro: true }],
  REVOCATORIA: [{ accion: 'REVOCAR', etiqueta: 'Revocar autorización y dar de baja', peligro: true }],
};

function Solicitudes() {
  const cache = useQueryClient();
  const [estado, setEstado] = useState('ABIERTAS');
  const [abierta, setAbierta] = useState<string>();
  const q = useQuery({ queryKey: ['titular', 'solicitudes', estado], queryFn: () => api.solicitudesTitular(estado) });

  return (
    <section className="dashboard-block">
      <div className="block-heading">
        <div>
          <h2>Solicitudes de titulares</h2>
          <small style={{ color: 'var(--texto-3)' }}>Consultas: 10 días hábiles. Actualización, supresión y revocatoria: 15 días hábiles.</small>
        </div>
        <div className="segmented" role="group">
          {[
            ['ABIERTAS', 'Abiertas'],
            ['RESPONDIDA', 'Respondidas'],
            ['RECHAZADA', 'Rechazadas'],
          ].map(([c, e]) => (
            <button key={c} type="button" className={estado === c ? 'selected' : ''} onClick={() => setEstado(c)}>
              {e}
            </button>
          ))}
        </div>
      </div>
      {q.isPending && <Cargando />}
      {q.isError && <ErrorEstado mensaje={q.error.message} reintentar={() => void q.refetch()} />}
      {q.data?.length === 0 && <div className="empty-inline">No hay solicitudes en este estado.</div>}
      <ul className="solicitudes-lider">
        {q.data?.map((s) => (
          <li key={s.id} className="solicitud-titular">
            <div className="solicitud-datos">
              <strong>
                {s.radicado} · {s.tipo}
              </strong>
              <span>
                Recibida el {fecha(s.recibida_en)} · responder a: {s.contacto_respuesta}
                {s.nombre ? ` · ${nombrePropio(s.nombre)}` : ' · la cédula no está en la base de datos'}
              </span>
              <p className="solicitud-texto">{s.descripcion}</p>
              {s.respuesta && <small>Respuesta: {s.respuesta}</small>}
              {abierta === s.id && (
                <Tramite
                  s={s}
                  onListo={() => {
                    setAbierta(undefined);
                    void cache.invalidateQueries({ queryKey: ['titular'] });
                  }}
                />
              )}
            </div>
            <div className="solicitud-acciones" style={{ flexDirection: 'column', alignItems: 'flex-end' }}>
              {s.estado === 'RECIBIDA' || s.estado === 'EN_TRAMITE' ? (
                <>
                  <span className={`estado-pill ${s.dias_habiles_restantes < 0 ? 'severidad-alta' : s.dias_habiles_restantes <= 3 ? 'severidad-media' : ''}`}>
                    {s.dias_habiles_restantes < 0 ? `Vencida hace ${-s.dias_habiles_restantes} días hábiles` : `Vence el ${fecha(s.fecha_limite)} (${s.dias_habiles_restantes} días hábiles)`}
                  </span>
                  <button type="button" className="secondary-button" onClick={() => setAbierta(abierta === s.id ? undefined : s.id)}>
                    {abierta === s.id ? 'Cerrar' : 'Tramitar'}
                  </button>
                </>
              ) : (
                <span className={`estado-pill ${s.estado === 'RESPONDIDA' ? 'estado-activo' : 'estado-retirado'}`}>
                  {s.estado === 'RESPONDIDA' ? 'Respondida' : 'Rechazada'} · {fecha(s.respondida_en)}
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Tramite({ s, onListo }: { s: SolicitudTitular; onListo: () => void }) {
  const [respuesta, setRespuesta] = useState('');
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [verDatos, setVerDatos] = useState(false);
  const datos = useQuery({ queryKey: ['titular', 'datos', s.id], queryFn: () => api.datosTitular(s.id), enabled: verDatos });

  async function tramitar(accion: string, peligro?: boolean) {
    if (peligro && !window.confirm(accion === 'SUPRIMIR' ? 'Se borrarán todos los datos de esta persona. No se puede deshacer. ¿Continuar?' : '¿Revocar la autorización? La persona queda retirada y sin mensajes.')) return;
    setError('');
    setGuardando(true);
    try {
      await api.tramitarSolicitudTitular(s.id, accion, respuesta.trim() || undefined);
      onListo();
    } catch (causa) {
      setError(causa instanceof Error ? causa.message : 'No fue posible tramitar la solicitud.');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="tramite">
      <ol className="helper">
        <li>Verifica que quien pide es el titular (por ejemplo, llamando o pidiendo copia de la cédula).</li>
        <li>Responde al contacto indicado y copia aquí la respuesta que enviaste.</li>
      </ol>
      {s.persona_encontrada && (
        <button type="button" className="link-button" onClick={() => setVerDatos(!verDatos)}>
          {verDatos ? 'Ocultar' : 'Ver'} los datos que tenemos de esta persona (queda en la bitácora)
        </button>
      )}
      {verDatos && datos.data && <pre className="datos-titular">{JSON.stringify(datos.data, null, 2)}</pre>}
      <label>
        Respuesta enviada al titular
        <textarea rows={3} value={respuesta} onChange={(e) => setRespuesta(e.target.value)} maxLength={4000} />
      </label>
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      <div className="form-actions" style={{ justifyContent: 'flex-start', flexWrap: 'wrap' }}>
        {s.estado === 'RECIBIDA' && (
          <button type="button" className="secondary-button" disabled={guardando} onClick={() => void tramitar('EN_TRAMITE')}>
            Pasar a "en trámite"
          </button>
        )}
        {ACCIONES[s.tipo_codigo].map((a) => (
          <button key={a.accion} type="button" className={a.peligro ? 'secondary-button boton-peligro' : 'primary-button'} disabled={guardando} onClick={() => void tramitar(a.accion, a.peligro)}>
            {a.etiqueta}
          </button>
        ))}
        <button type="button" className="secondary-button" disabled={guardando} onClick={() => void tramitar('RECHAZAR')}>
          Rechazar (con motivo)
        </button>
      </div>
    </div>
  );
}

const ACCIONES_BITACORA: Record<string, string> = {
  INSERT: 'Creó',
  UPDATE: 'Editó',
  DELETE: 'Borró',
  CONSULTA: 'Consultó dato sensible',
  EXPORTACION: 'Exportó',
  LOGIN: 'Ingresó',
  LOGIN_FALLIDO: 'Ingreso fallido',
  MFA_ACTIVADO: 'Activó 2FA',
  MFA_FALLIDO: '2FA fallido',
  MFA_RESTABLECIDO: '2FA restablecido',
  CODIGO_RECUPERACION_USADO: 'Usó código de recuperación',
  RENOVACION_REUTILIZADA: 'Sesión reutilizada (posible robo)',
};

function Bitacora() {
  const [f, setF] = useState<{ usuario?: string; accion?: string; desde?: string; hasta?: string }>({});
  const [pagina, setPagina] = useState(1);
  const q = useQuery({ queryKey: ['bitacora', f, pagina], queryFn: () => api.bitacoraAuditoria({ ...f, pagina }) });
  const cambiar = (c: Partial<typeof f>) => {
    setF({ ...f, ...c });
    setPagina(1);
  };
  return (
    <>
      <section className="filtros-mapa">
        <label>
          Usuario
          <input placeholder="correo o parte" value={f.usuario ?? ''} onChange={(e) => cambiar({ usuario: e.target.value || undefined })} />
        </label>
        <label>
          Acción
          <select value={f.accion ?? ''} onChange={(e) => cambiar({ accion: e.target.value || undefined })}>
            <option value="">Todas</option>
            {Object.entries(ACCIONES_BITACORA).map(([c, e]) => (
              <option key={c} value={c}>
                {e}
              </option>
            ))}
          </select>
        </label>
        <label>
          Desde
          <input type="date" value={f.desde ?? ''} onChange={(e) => cambiar({ desde: e.target.value || undefined })} />
        </label>
        <label>
          Hasta
          <input type="date" value={f.hasta ?? ''} onChange={(e) => cambiar({ hasta: e.target.value || undefined })} />
        </label>
        <small className="helper">La bitácora no se puede editar ni borrar. Guarda qué registro y qué campos cambiaron, nunca los datos personales.</small>
      </section>
      {q.isPending && <Cargando />}
      {q.isError && <ErrorEstado mensaje={q.error.message} />}
      {q.data && (
        <section className="dashboard-block">
          <div className="table-wrap tabla-reporte">
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Usuario</th>
                  <th>Acción</th>
                  <th>Dónde</th>
                  <th>Campos</th>
                  <th>IP</th>
                </tr>
              </thead>
              <tbody>
                {q.data.datos.map((r) => (
                  <tr key={r.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{fechaHora(r.ocurrido_en)}</td>
                    <td>{r.usuario}</td>
                    <td>
                      <span className={`estado-pill ${['LOGIN_FALLIDO', 'MFA_FALLIDO', 'RENOVACION_REUTILIZADA', 'DELETE'].includes(r.accion) ? 'severidad-media' : ''}`}>
                        {ACCIONES_BITACORA[r.accion] ?? r.accion}
                      </span>
                    </td>
                    <td>
                      {r.tabla ? `${r.esquema}.${r.tabla}` : '—'}
                      {r.registro_id && <small>{r.registro_id}</small>}
                    </td>
                    <td>{r.campos ?? '—'}</td>
                    <td>{r.ip ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {q.data.total > q.data.porPagina && (
            <div className="pager">
              <button type="button" disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)}>
                Anterior
              </button>
              <span>
                Página {pagina} de {Math.ceil(q.data.total / q.data.porPagina)} · {q.data.total.toLocaleString('es-CO')} eventos
              </span>
              <button type="button" disabled={pagina * q.data.porPagina >= q.data.total} onClick={() => setPagina(pagina + 1)}>
                Siguiente
              </button>
            </div>
          )}
        </section>
      )}
    </>
  );
}
