import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api, type EstadoProyeccion, type Indicadores, type LiderRanking } from '../api/cliente';
import { ESTADOS_PROYECCION } from './ReportesPage';
import { nombrePropio } from '../util/nombres';
import { Cargando, ErrorEstado } from '../componentes/Estados';
import { useSesion } from '../sesion/SesionContext';

const numberFormat = new Intl.NumberFormat('es-CO');
const dateFormat = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });
const shortDateFormat = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short' });
// Una sola serie: un solo color. El orden lo da la longitud de la barra.
const COLORS = ['#3987e5'];

function number(value: number | null | undefined) { return numberFormat.format(Number(value ?? 0)); }
function date(value: string | null | undefined, short = false) { if (!value) return 'Nunca'; const parsed = new Date(value.includes('T') ? value : `${value}T12:00:00`); return Number.isNaN(parsed.getTime()) ? 'Sin fecha' : (short ? shortDateFormat : dateFormat).format(parsed); }
function dateRange(days: number) { const end = new Date(); const start = new Date(end); start.setDate(end.getDate() - days + 1); const iso = (item: Date) => { const year = item.getFullYear(); const month = String(item.getMonth() + 1).padStart(2, '0'); const day = String(item.getDate()).padStart(2, '0'); return `${year}-${month}-${day}`; }; return { desde: iso(start), hasta: iso(end) }; }

function Block({ title, query, children }: { title: string; query: { isPending: boolean; isError: boolean; error: Error | null; refetch: () => unknown }; children: ReactNode }) {
  return <section className="dashboard-block"><div className="block-heading"><h2>{title}</h2>{query.isError && <button type="button" className="retry-link" onClick={() => void query.refetch()}>Reintentar</button>}</div>{query.isPending && <Cargando texto="Cargando datos..." />}{query.isError && <ErrorEstado mensaje={query.error?.message ?? 'No fue posible cargar este bloque.'} />}{!query.isPending && !query.isError && children}</section>;
}

function IndicatorCard({ label, value, featured, accent, to }: { label: string; value: number | null | undefined; featured?: boolean; accent?: string; to?: string }) {
  const className = `indicator-card ${featured ? 'featured' : ''}`;
  // El acento de color quedó fuera del diseño: todas las tarjetas comparten estilo.
  void accent;
  const style = undefined;
  const contenido = <><span>{label}</span><strong>{number(value)}</strong></>;
  return to
    ? <Link to={to} className={className} style={style}>{contenido}</Link>
    : <article className={className} style={style}>{contenido}</article>;
}

export function TableroPage() {
  const { tienePermiso } = useSesion();
  const [days, setDays] = useState(30);
  const range = dateRange(days);
  const indicadores = useQuery({ queryKey: ['tablero', 'indicadores'], queryFn: api.indicadores });
  const diarios = useQuery({ queryKey: ['tablero', 'diarios', days, range.desde, range.hasta], queryFn: () => api.registrosDiarios(range.desde, range.hasta) });
  const ranking = useQuery({ queryKey: ['tablero', 'ranking'], queryFn: () => api.ranking(10) });
  const inactivos = useQuery({ queryKey: ['tablero', 'inactivos'], queryFn: api.lideresInactivos });
  const metas = useQuery({ queryKey: ['tablero', 'metas'], queryFn: api.metas });
  const necesidades = useQuery({ queryKey: ['tablero', 'necesidades'], queryFn: api.necesidades });
  const indicadorData = indicadores.data as Indicadores | undefined;
  const chartData = (diarios.data ?? []).map(item => ({ ...item, etiqueta: date(item.fecha, true), registros: Number(item.registros ?? 0) }));
  const necesidadesData = useMemo(() => { const grouped = new Map<string, number>(); for (const item of necesidades.data?.porMunicipio ?? []) { const key = item.categoria ?? item.categoria_codigo ?? 'Otra'; grouped.set(key, (grouped.get(key) ?? 0) + Number(item.cantidad ?? 0)); } return [...grouped].map(([categoria, cantidad]) => ({ categoria, cantidad })).sort((a, b) => b.cantidad - a.cantidad); }, [necesidades.data]);
  const proyeccion = useQuery({ queryKey: ['reporte', 'proyeccion'], queryFn: api.proyeccionMetas });

  return <main className="page-content dashboard-page">
    <div className="page-heading"><div><p className="eyebrow">Lectura de campaña</p><h1>Tablero</h1><p className="dashboard-subtitle">Indicadores y señales de tu territorio operativo.</p></div><span className="permission-note">Actualizado con datos protegidos</span></div>
    <Block title="Indicadores" query={indicadores}>{indicadorData && <TarjetasIndicadores datos={indicadorData} verAlertas={tienePermiso('ALERTA_GESTIONAR')} />}</Block>
    <Block title="Proyección de metas" query={proyeccion}>{proyeccion.data && <ResumenProyeccion filas={proyeccion.data} />}</Block>
    <Block title="Registros diarios" query={diarios}><div className="chart-toolbar"><div><strong>Ritmo de registro</strong><span>Últimos {days} días</span></div><div className="segmented" role="group" aria-label="Periodo de registros">{[7, 30, 90].map(option => <button key={option} type="button" className={days === option ? 'selected' : ''} onClick={() => setDays(option)}>{option} días</button>)}</div></div>{chartData.length ? <><div className="chart-box"><ResponsiveContainer width="100%" height="100%"><LineChart data={chartData} margin={{ top: 12, right: 12, bottom: 4, left: -12 }}><CartesianGrid stroke="#e7eaef" vertical={false} /><XAxis dataKey="etiqueta" tick={{ fontSize: 11 }} /><YAxis allowDecimals={false} tick={{ fontSize: 11 }} /><Tooltip formatter={(value) => [number(Number(value)), 'Registros']} /><Line type="linear" dataKey="registros" stroke="#1c5cab" strokeWidth={2} dot={{ r: 3, fill: '#1c5cab', strokeWidth: 0 }} activeDot={{ r: 5, fill: '#1c5cab', stroke: '#ffffff', strokeWidth: 2 }} /></LineChart></ResponsiveContainer></div><details className="chart-alt"><summary>Ver tabla de registros</summary><table><thead><tr><th>Fecha</th><th>Registros</th></tr></thead><tbody>{chartData.map(item => <tr key={item.fecha}><td>{date(item.fecha)}</td><td>{number(item.registros)}</td></tr>)}</tbody></table></details></> : <div className="empty-inline">No hay registros en este periodo.</div>}</Block>
    <div className="dashboard-two-columns"><Block title="Ranking de líderes" query={ranking}>{ranking.data?.length ? <div className="ranking-list">{ranking.data.map((leader, index) => <div className="ranking-row" key={leader.miembro_id ?? leader.nombre}><span className="rank-number">{String(index + 1).padStart(2, '0')}</span><div><strong>{nombrePropio(leader.nombre) || 'Sin nombre'}</strong><small>{number(leader.ultimos_7_dias)} en últimos 7 días</small></div><b>{number(leader.activos)}</b></div>)}</div> : <div className="empty-inline">No hay líderes para mostrar.</div>}</Block><Block title="Líderes inactivos" query={inactivos}>{inactivos.data?.length ? <div className="inactive-list">{inactivos.data.map((leader: LiderRanking) => <div key={leader.miembro_id ?? leader.nombre}><span className="inactive-dot" /><div><strong>{nombrePropio(leader.nombre) || 'Sin nombre'}</strong><small>Último registro: {date(leader.ultimo_registro)}</small></div></div>)}</div> : <div className="empty-inline">No hay líderes inactivos.</div>}</Block></div>
    <Block title="Avance de metas" query={metas}>{metas.data && <div className="goals-grid"><div><h3>Por miembro</h3>{metas.data.miembros.length ? metas.data.miembros.map(goal => <GoalRow key={`${goal.miembro_id}-${goal.fecha_limite}`} label={nombrePropio(goal.nombre) || 'Miembro'} porcentaje={goal.porcentaje} registrados={goal.registrados} meta={goal.meta} fecha={goal.fecha_limite} />) : <div className="empty-inline">No hay metas por miembro.</div>}</div><div><h3>Por territorio</h3>{metas.data.territorios.length ? metas.data.territorios.map(goal => <GoalRow key={`${goal.territorio_id}-${goal.fecha_limite}`} label={nombrePropio(goal.territorio) || 'Territorio'} porcentaje={goal.porcentaje} registrados={goal.registrados} meta={goal.meta} fecha={goal.fecha_limite} />) : <div className="empty-inline">No hay metas territoriales.</div>}</div></div>}</Block>
    <Block title="Necesidades del territorio" query={necesidades}>{necesidades.data && <div className="needs-layout"><div>{necesidadesData.length ? <><div className="chart-box needs-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={necesidadesData} layout="vertical" margin={{ left: 20, right: 14 }}><CartesianGrid stroke="#e7eaef" horizontal={false} /><XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} /><YAxis type="category" dataKey="categoria" width={100} tick={{ fontSize: 11 }} /><Tooltip formatter={(value) => [number(Number(value)), 'Reportes']} /><Bar dataKey="cantidad" radius={[0, 4, 4, 0]} barSize={18}>{necesidadesData.map((item, index) => <Cell key={item.categoria} fill={COLORS[index % COLORS.length]} />)}</Bar></BarChart></ResponsiveContainer></div><details className="chart-alt"><summary>Ver tabla de necesidades</summary><table><thead><tr><th>Categoría</th><th>Reportes</th></tr></thead><tbody>{necesidadesData.map(item => <tr key={item.categoria}><td>{item.categoria}</td><td>{number(item.cantidad)}</td></tr>)}</tbody></table></details></> : <div className="empty-inline">No hay necesidades reportadas.</div>}</div><aside className="no-proposal"><p className="eyebrow">Atención programática</p><h3>Temas sin propuesta</h3>{necesidades.data.sinPropuesta.length ? <ul>{necesidades.data.sinPropuesta.map(item => <li key={item.codigo}><strong>{item.nombre ?? item.codigo}</strong><span>{number(item.necesidades)} reportes</span></li>)}</ul> : <p className="empty-inline">Todas las categorías tienen una propuesta publicada.</p>}</aside></div>}</Block>
  </main>;
}

function Variacion({ actual, anterior, texto }: { actual: number | null; anterior: number | null; texto: string }) {
  const a = Number(actual ?? 0);
  const b = Number(anterior ?? 0);
  if (!b) return <small className="variacion">{a ? `${texto}: sin registros` : `Igual que ${texto}`}</small>;
  const cambio = Math.round(((a - b) / b) * 100);
  const clase = cambio > 0 ? 'sube' : cambio < 0 ? 'baja' : '';
  return <small className={`variacion ${clase}`}>{cambio > 0 ? '▲' : cambio < 0 ? '▼' : '='} {Math.abs(cambio)} % vs. {texto} ({number(b)})</small>;
}

function TarjetasIndicadores({ datos, verAlertas }: { datos: Indicadores; verAlertas: boolean }) {
  const avance = datos.avance_pct === null ? null : Math.max(0, Math.min(100, Number(datos.avance_pct)));
  return <div className="indicator-grid">
    <article className="indicator-card featured">
      <span>Simpatizantes activos</span>
      <strong>{number(datos.simpatizantes_activos)}</strong>
      {avance === null ? <small className="variacion">Sin meta asignada</small> : <>
        <span className="goal-track indicador-meta"><i className={avance < 50 ? 'low' : ''} style={{ width: `${avance}%` }} /></span>
        <small className="variacion">{Number(datos.avance_pct).toLocaleString('es-CO', { maximumFractionDigits: 1 })} % de la meta de {number(datos.meta)}</small>
      </>}
    </article>
    <article className="indicator-card"><span>Registros de hoy</span><strong>{number(datos.registros_hoy)}</strong><Variacion actual={datos.registros_hoy} anterior={datos.registros_ayer} texto="ayer" /></article>
    <article className="indicator-card"><span>Últimos 7 días</span><strong>{number(datos.registros_semana)}</strong><Variacion actual={datos.registros_semana} anterior={datos.registros_semana_anterior} texto="semana anterior" /></article>
    <article className="indicator-card"><span>Últimos 30 días</span><strong>{number(datos.registros_mes)}</strong><small className="variacion">Promedio: {number(Math.round(Number(datos.registros_mes ?? 0) / 30))} por día</small></article>
    <article className="indicator-card"><span>Líderes que registraron esta semana</span><strong>{number(datos.lideres_con_registros_semana)}</strong><small className="variacion">de {number(datos.miembros_activos)} miembros activos</small></article>
    <IndicatorCard label="Necesidades reportadas" value={datos.necesidades_reportadas} />
    {verAlertas && <IndicatorCard label="Alertas abiertas" value={datos.alertas_abiertas} to="/alertas" />}
  </div>;
}

function ResumenProyeccion({ filas }: { filas: { estado: EstadoProyeccion; nombre: string; proyectado_pct: string; fecha_limite: string; tipo: string }[] }) {
  if (!filas.length) return <div className="empty-inline">No hay metas asignadas en tu alcance.</div>;
  const riesgo = filas.filter((f) => f.estado === 'NO_ALCANZA' || f.estado === 'EN_RIESGO' || f.estado === 'VENCIDA').slice(0, 6);
  return <div className="proyeccion-tablero">
    <div className="proyeccion-resumen">{(['NO_ALCANZA', 'EN_RIESGO', 'EN_CAMINO', 'CUMPLIDA'] as EstadoProyeccion[]).map((e) => <div key={e} className={`proyeccion-cifra ${ESTADOS_PROYECCION[e].clase}`}><strong>{filas.filter((f) => f.estado === e).length}</strong><span>{ESTADOS_PROYECCION[e].etiqueta}</span></div>)}</div>
    {riesgo.length > 0 ? <ul className="proyeccion-riesgo">{riesgo.map((f) => <li key={`${f.tipo}-${f.nombre}-${f.fecha_limite}`}><strong>{nombrePropio(f.nombre)}</strong><span>llegaría al {Number(f.proyectado_pct).toLocaleString('es-CO', { maximumFractionDigits: 0 })} % el {date(f.fecha_limite, true)}</span><span className={`estado-pill ${ESTADOS_PROYECCION[f.estado].clase}`}>{ESTADOS_PROYECCION[f.estado].etiqueta}</span></li>)}</ul> : <p className="empty-inline">Al ritmo actual, todas las metas se cumplen a tiempo.</p>}
    <Link to="/reportes" className="link-button">Ver la proyección completa en Reportes →</Link>
  </div>;
}

function GoalRow({ label, porcentaje, registrados, meta, fecha }: { label: string; porcentaje: number | null; registrados: number | null; meta: number | null; fecha: string | null }) { const progress = Math.max(0, Math.min(100, Number(porcentaje ?? 0))); return <div className="goal-row"><div className="goal-label"><strong>{label}</strong><span>{number(registrados)} / {number(meta)} · vence {date(fecha, true)}</span></div><div className="goal-track"><i className={progress < 50 ? 'low' : ''} style={{ width: `${progress}%` }} /></div><b>{progress.toLocaleString('es-CO', { maximumFractionDigits: 1 })}%</b></div>; }
