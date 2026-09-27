import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { api, type AgendaVisita } from '../api/cliente';
import { Cargando, ErrorEstado } from '../componentes/Estados';
import { nombrePropio } from '../util/nombres';
import { descargar, tarjetaConQr } from '../util/tarjetaQr';

const hora = (v: string) => new Date(v).toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' });

/** QR de check-in, asistencia manual por cédula y lista de asistentes de un evento. */
export function AsistenciaEvento({ visita, gestionar }: { visita: AgendaVisita; gestionar: boolean }) {
  const cache = useQueryClient();
  const asistencia = useQuery({
    queryKey: ['agenda', 'asistencia', visita.id],
    queryFn: () => api.agendaAsistencia(visita.id),
    refetchInterval: visita.estado === 'CANCELADA' ? false : 30_000,
  });
  const url = asistencia.data ? `${window.location.origin}/e/${asistencia.data.codigo}` : '';
  const qr = useQuery({ queryKey: ['evento-qr', url], queryFn: () => QRCode.toDataURL(url, { margin: 1, width: 280 }), enabled: Boolean(url) });
  const [documento, setDocumento] = useState('');
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string }>();
  const [copiado, setCopiado] = useState(false);

  async function marcar(e: FormEvent) {
    e.preventDefault();
    setAviso(undefined);
    try {
      const r = await api.agendaMarcarAsistencia(visita.id, documento);
      setAviso({
        ok: true,
        texto: r.resultado === 'YA_REGISTRADA' ? `${nombrePropio(r.nombre)} ya tenía la asistencia registrada.` : `Asistencia registrada: ${nombrePropio(r.nombre)}.`,
      });
      setDocumento('');
      void cache.invalidateQueries({ queryKey: ['agenda', 'asistencia', visita.id] });
    } catch (causa) {
      setAviso({ ok: false, texto: causa instanceof Error ? causa.message : 'No se pudo registrar la asistencia.' });
    }
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(url);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      setCopiado(false);
    }
  }

  if (asistencia.isPending) return <Cargando texto="Cargando asistencia..." />;
  if (asistencia.isError) return <ErrorEstado mensaje={asistencia.error.message} />;
  const d = asistencia.data;

  return (
    <section className="asistencia-evento">
      <div className="asistencia-qr">
        {qr.data && <img src={qr.data} alt={`Código QR para registrar asistencia a ${visita.nombre ?? 'el evento'}`} />}
        <div>
          <h2>Registro de asistencia por QR</h2>
          <p className="helper">
            Imprime o proyecta este código en el evento. Quien lo escanea registra su asistencia desde el celular. Si no estaba en la base, queda
            registrado como simpatizante y se le acredita a quien creó el evento. El registro se abre una hora antes y se cierra una hora después.
          </p>
          <p className="codigo-evento">
            <span className="codigo">{d.codigo}</span> · <a href={url}>{url.replace(/^https?:\/\//, '')}</a>
          </p>
          <div className="form-actions">
            <button type="button" className="secondary-button" onClick={() => void copiar()}>
              {copiado ? 'Copiado' : 'Copiar enlace'}
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={() =>
                void tarjetaConQr(visita.nombre ?? 'Evento', d.codigo, url, 'Escanea y registra tu asistencia').then((t) => descargar(t, `evento-${d.codigo}.png`))
              }
            >
              Descargar para imprimir
            </button>
          </div>
        </div>
      </div>

      <div className="asistencia-cifras">
        <div>
          <strong>{d.total}</strong>
          <span>asistentes registrados</span>
        </div>
        <div>
          <strong>{d.nuevos}</strong>
          <span>personas nuevas para la campaña</span>
        </div>
        <div>
          <strong>{visita.asistentes_aprox ?? '—'}</strong>
          <span>asistentes aproximados (reporte)</span>
        </div>
      </div>

      {gestionar && (
        <form className="inline-form asistencia-manual" onSubmit={marcar}>
          <label>
            Marcar asistencia por cédula (personas ya registradas)
            <input inputMode="numeric" pattern="[0-9]{5,10}" value={documento} onChange={(e) => setDocumento(e.target.value.replace(/\D/g, ''))} placeholder="Número de cédula" required />
          </label>
          <button className="primary-button">Marcar</button>
          {aviso && (
            <p className={aviso.ok ? 'form-success' : 'form-error'} role="status">
              {aviso.texto}
            </p>
          )}
        </form>
      )}

      {d.asistentes.length === 0 ? (
        <div className="empty-inline">Todavía no hay asistentes registrados.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Asistente</th>
                <th>Vive en</th>
                <th>Cómo</th>
                <th>Hora</th>
              </tr>
            </thead>
            <tbody>
              {d.asistentes.map((a) => (
                <tr key={a.persona_id}>
                  <td>
                    {nombrePropio(a.nombre)} {a.nuevo && <span className="estado-pill">Nuevo</span>}
                  </td>
                  <td>{a.residencia ? nombrePropio(a.residencia.split(' > ').slice(1).join(', ')) : '—'}</td>
                  <td>{a.metodo === 'QR' ? 'QR' : 'Equipo'}</td>
                  <td>{hora(a.registrada_en)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
