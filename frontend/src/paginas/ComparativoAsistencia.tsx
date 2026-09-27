import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, type FilaComparativo } from '../api/cliente';
import { Cargando, ErrorEstado } from '../componentes/Estados';
import { nombrePropio } from '../util/nombres';

const hoy = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
const haceDias = (n: number) => new Date(Date.now() - n * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
const numero = (n: number) => n.toLocaleString('es-CO');
const SUFIJO = ' (sin vereda o barrio)';
const nombreZona = (z: string) => (z.endsWith(SUFIJO) ? `${nombrePropio(z.slice(0, -SUFIJO.length))} (cabecera o sin vereda)` : nombrePropio(z));
const FILAS_INICIALES = 25;

/** Lectura automática de la tabla: dónde falta presencia y dónde los eventos no se convierten. */
function hallazgos(filas: FilaComparativo[]) {
  const sinEventos = filas.filter((f) => f.eventos === 0 && f.referidos > 0).sort((a, b) => b.referidos - a.referidos).slice(0, 3);
  const pocaConversion = filas.filter((f) => f.asistentes >= 10 && f.asistentes_nuevos / f.asistentes < 0.1).slice(0, 3);
  const mejores = filas.filter((f) => f.asistentes_nuevos > 0).sort((a, b) => b.asistentes_nuevos - a.asistentes_nuevos).slice(0, 3);
  const out: string[] = [];
  if (sinEventos.length) out.push(`Con referidos pero sin eventos: ${sinEventos.map((f) => `${nombreZona(f.zona)} (${numero(f.referidos)})`).join(', ')}.`);
  if (mejores.length) out.push(`Donde los eventos más sumaron personas nuevas: ${mejores.map((f) => `${nombreZona(f.zona)} (${numero(f.asistentes_nuevos)})`).join(', ')}.`);
  if (pocaConversion.length) out.push(`Mucha asistencia y pocos nuevos (menos del 10 %): ${pocaConversion.map((f) => nombreZona(f.zona)).join(', ')}. Ahí el evento llega a quienes ya estaban.`);
  return out;
}

export function ComparativoAsistencia() {
  const [desde, setDesde] = useState(haceDias(90));
  const [hasta, setHasta] = useState(hoy());
  const [municipioId, setMunicipioId] = useState('');
  const [todas, setTodas] = useState(false);
  const municipios = useQuery({ queryKey: ['municipios'], queryFn: api.municipios });
  const datos = useQuery({
    queryKey: ['agenda', 'comparativo', desde, hasta, municipioId],
    queryFn: () => api.agendaComparativo({ desde, hasta, municipioId: municipioId ? Number(municipioId) : undefined }),
    enabled: Boolean(desde && hasta),
  });
  const filas = datos.data ?? [];
  const grafico = filas
    .slice(0, 12)
    .map((f) => ({ zona: nombreZona(f.zona).replace(' (cabecera o sin vereda)', ' (cabecera)'), Asistentes: f.asistentes, Referidos: f.referidos }));
  const notas = hallazgos(filas);

  return (
    <section className="agenda-card">
      <div className="filtros-mapa">
        <label>
          Desde
          <input type="date" value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)} />
        </label>
        <label>
          Hasta
          <input type="date" value={hasta} min={desde} onChange={(e) => setHasta(e.target.value)} />
        </label>
        <label>
          Zona
          <select value={municipioId} onChange={(e) => setMunicipioId(e.target.value)}>
            <option value="">Todo el departamento (por municipio)</option>
            {municipios.data?.map((m) => (
              <option key={m.id} value={m.id}>
                {nombrePropio(m.nombre)} (por vereda o barrio)
              </option>
            ))}
          </select>
        </label>
        <p className="helper">
          Asistentes: personas distintas que registraron asistencia a eventos de la zona. Referidos: simpatizantes registrados en el periodo que viven
          en la zona. Solo cuenta lo que tu rol puede ver.
        </p>
      </div>

      {datos.isPending && <Cargando texto="Calculando..." />}
      {datos.isError && <ErrorEstado mensaje={datos.error.message} />}
      {datos.data && filas.length === 0 && <div className="empty-inline">No hay eventos ni referidos en este periodo.</div>}
      {filas.length > 0 && (
        <>
          {notas.length > 0 && (
            <ul className="comparativo-hallazgos">
              {notas.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
          <div className="chart-box comparativo-grafico">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={grafico} margin={{ left: 0, right: 12, bottom: 40 }}>
                <CartesianGrid stroke="#e7eaef" vertical={false} />
                <XAxis dataKey="zona" tick={{ fontSize: 11 }} interval={0} angle={-30} textAnchor="end" height={70} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend verticalAlign="top" height={28} />
                <Bar dataKey="Asistentes" fill="#1c5cab" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Referidos" fill="#9ec5f4" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="table-wrap tabla-reporte">
            <table>
              <thead>
                <tr>
                  <th>Zona</th>
                  <th>Eventos</th>
                  <th>Asistentes</th>
                  <th>Nuevos en eventos</th>
                  <th>Referidos</th>
                  <th>% de referidos que llegó por eventos</th>
                </tr>
              </thead>
              <tbody>
                {(todas ? filas : filas.slice(0, FILAS_INICIALES)).map((f) => (
                  <tr key={f.zona_id}>
                    <td>{nombreZona(f.zona)}</td>
                    <td>{numero(f.eventos)}</td>
                    <td>{numero(f.asistentes)}</td>
                    <td>{numero(f.asistentes_nuevos)}</td>
                    <td>{numero(f.referidos)}</td>
                    <td>{f.referidos ? `${Math.round((f.referidos_en_eventos / f.referidos) * 100)} %` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filas.length > FILAS_INICIALES && (
              <button type="button" className="link-button" onClick={() => setTodas(!todas)}>
                {todas ? 'Ver menos' : `Ver las ${filas.length} zonas`}
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
