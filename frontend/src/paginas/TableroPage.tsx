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
import { api, type Indicadores, type LiderRanking } from '../api/cliente';
import { Cargando, ErrorEstado } from '../componentes/Estados';
import { useSesion } from '../sesion/SesionContext';

const numberFormat = new Intl.NumberFormat('es-CO');
const dateFormat = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });
const shortDateFormat = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short' });
const COLORS = ['#2e7c68', '#4b9b70', '#e58b45', '#b36a3f', '#7b665d', '#173331'];

function number(value: number | null | undefined) { return numberFormat.format(Number(value ?? 0)); }
function date(value: string | null | undefined, short = false) { if (!value) return 'Nunca'; const parsed = new Date(value.includes('T') ? value : `${value}T12:00:00`); return Number.isNaN(parsed.getTime()) ? 'Sin fecha' : (short ? shortDateFormat : dateFormat).format(parsed); }
function dateRange(days: number) { const end = new Date(); const start = new Date(end); start.setDate(end.getDate() - days + 1); const iso = (item: Date) => { const year = item.getFullYear(); const month = String(item.getMonth() + 1).padStart(2, '0'); const day = String(item.getDate()).padStart(2, '0'); return `${year}-${month}-${day}`; }; return { desde: iso(start), hasta: iso(end) }; }

function Block({ title, query, children }: { title: string; query: { isPending: boolean; isError: boolean; error: Error | null; refetch: () => unknown }; children: ReactNode }) {
  return <section className="dashboard-block"><div className="block-heading"><h2>{title}</h2>{query.isError && <button type="button" className="retry-link" onClick={() => void query.refetch()}>Reintentar</button>}</div>{query.isPending && <Cargando texto="Cargando datos..." />}{query.isError && <ErrorEstado mensaje={query.error?.message ?? 'No fue posible cargar este bloque.'} />}{!query.isPending && !query.isError && children}</section>;
}

function IndicatorCard({ label, value, featured, accent, to }: { label: string; value: number | null | undefined; featured?: boolean; accent?: string; to?: string }) {
  const className = `indicator-card ${featured ? 'featured' : ''}`;
  const style = accent ? { borderTopColor: accent } : undefined;
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
  const indicadoresList = [
    { label: 'Registros de hoy', value: indicadorData?.registros_hoy, accent: '#4b9b70' },
    { label: 'Registros de la semana', value: indicadorData?.registros_semana, accent: '#e58b45' },
    { label: 'Miembros activos', value: indicadorData?.miembros_activos, accent: '#2e7c68' },
    { label: 'Necesidades reportadas', value: indicadorData?.necesidades_reportadas, accent: '#b36a3f' },
  ];

  return <main className="page-content dashboard-page">
    <div className="page-heading"><div><p className="eyebrow">Lectura de campaña</p><h1>Tablero</h1><p className="dashboard-subtitle">Indicadores y señales de tu territorio operativo.</p></div><span className="permission-note">Actualizado con datos protegidos</span></div>
    <Block title="Indicadores" query={indicadores}>{indicadorData && <div className="indicator-grid"><IndicatorCard label="Simpatizantes activos" value={indicadorData.simpatizantes_activos} featured accent="#e8bd68" />{indicadoresList.map(item => <IndicatorCard key={item.label} {...item} />)}{tienePermiso('ALERTA_GESTIONAR') && <IndicatorCard label="Alertas abiertas" value={indicadorData.alertas_abiertas} accent="#963f36" to="/alertas" />}</div>}</Block>
    <Block title="Registros diarios" query={diarios}><div className="chart-toolbar"><div><strong>Ritmo de registro</strong><span>Últimos {days} días</span></div><div className="segmented" role="group" aria-label="Periodo de registros">{[7, 30, 90].map(option => <button key={option} type="button" className={days === option ? 'selected' : ''} onClick={() => setDays(option)}>{option} días</button>)}</div></div>{chartData.length ? <><div className="chart-box"><ResponsiveContainer width="100%" height="100%"><LineChart data={chartData} margin={{ top: 12, right: 12, bottom: 4, left: -12 }}><CartesianGrid stroke="#dce6dd" vertical={false} /><XAxis dataKey="etiqueta" tick={{ fontSize: 11 }} /><YAxis allowDecimals={false} tick={{ fontSize: 11 }} /><Tooltip formatter={(value) => [number(Number(value)), 'Registros']} /><Line type="monotone" dataKey="registros" stroke="#2e7c68" strokeWidth={3} dot={{ r: 3, fill: '#e8bd68' }} /></LineChart></ResponsiveContainer></div><details className="chart-alt"><summary>Ver tabla de registros</summary><table><thead><tr><th>Fecha</th><th>Registros</th></tr></thead><tbody>{chartData.map(item => <tr key={item.fecha}><td>{date(item.fecha)}</td><td>{number(item.registros)}</td></tr>)}</tbody></table></details></> : <div className="empty-inline">No hay registros en este periodo.</div>}</Block>
    <div className="dashboard-two-columns"><Block title="Ranking de líderes" query={ranking}>{ranking.data?.length ? <div className="ranking-list">{ranking.data.map((leader, index) => <div className="ranking-row" key={leader.miembro_id ?? leader.nombre}><span className="rank-number">{String(index + 1).padStart(2, '0')}</span><div><strong>{leader.nombre ?? 'Sin nombre'}</strong><small>{number(leader.ultimos_7_dias)} en últimos 7 días</small></div><b>{number(leader.activos)}</b></div>)}</div> : <div className="empty-inline">No hay líderes para mostrar.</div>}</Block><Block title="Líderes inactivos" query={inactivos}>{inactivos.data?.length ? <div className="inactive-list">{inactivos.data.map((leader: LiderRanking) => <div key={leader.miembro_id ?? leader.nombre}><span className="inactive-dot" /><div><strong>{leader.nombre ?? 'Sin nombre'}</strong><small>Último registro: {date(leader.ultimo_registro)}</small></div></div>)}</div> : <div className="empty-inline">No hay líderes inactivos.</div>}</Block></div>
    <Block title="Avance de metas" query={metas}>{metas.data && <div className="goals-grid"><div><h3>Por miembro</h3>{metas.data.miembros.length ? metas.data.miembros.map(goal => <GoalRow key={`${goal.miembro_id}-${goal.fecha_limite}`} label={goal.nombre ?? 'Miembro'} porcentaje={goal.porcentaje} registrados={goal.registrados} meta={goal.meta} fecha={goal.fecha_limite} />) : <div className="empty-inline">No hay metas por miembro.</div>}</div><div><h3>Por territorio</h3>{metas.data.territorios.length ? metas.data.territorios.map(goal => <GoalRow key={`${goal.territorio_id}-${goal.fecha_limite}`} label={goal.territorio ?? 'Territorio'} porcentaje={goal.porcentaje} registrados={goal.registrados} meta={goal.meta} fecha={goal.fecha_limite} />) : <div className="empty-inline">No hay metas territoriales.</div>}</div></div>}</Block>
    <Block title="Necesidades del territorio" query={necesidades}>{necesidades.data && <div className="needs-layout"><div>{necesidadesData.length ? <><div className="chart-box needs-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={necesidadesData} layout="vertical" margin={{ left: 20, right: 14 }}><CartesianGrid stroke="#dce6dd" horizontal={false} /><XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} /><YAxis type="category" dataKey="categoria" width={100} tick={{ fontSize: 11 }} /><Tooltip formatter={(value) => [number(Number(value)), 'Reportes']} /><Bar dataKey="cantidad" radius={[0, 3, 3, 0]}>{necesidadesData.map((item, index) => <Cell key={item.categoria} fill={COLORS[index % COLORS.length]} />)}</Bar></BarChart></ResponsiveContainer></div><details className="chart-alt"><summary>Ver tabla de necesidades</summary><table><thead><tr><th>Categoría</th><th>Reportes</th></tr></thead><tbody>{necesidadesData.map(item => <tr key={item.categoria}><td>{item.categoria}</td><td>{number(item.cantidad)}</td></tr>)}</tbody></table></details></> : <div className="empty-inline">No hay necesidades reportadas.</div>}</div><aside className="no-proposal"><p className="eyebrow">Atención programática</p><h3>Temas sin propuesta</h3>{necesidades.data.sinPropuesta.length ? <ul>{necesidades.data.sinPropuesta.map(item => <li key={item.codigo}><strong>{item.nombre ?? item.codigo}</strong><span>{number(item.necesidades)} reportes</span></li>)}</ul> : <p className="empty-inline">Todas las categorías tienen una propuesta publicada.</p>}</aside></div>}</Block>
  </main>;
}

function GoalRow({ label, porcentaje, registrados, meta, fecha }: { label: string; porcentaje: number | null; registrados: number | null; meta: number | null; fecha: string | null }) { const progress = Math.max(0, Math.min(100, Number(porcentaje ?? 0))); return <div className="goal-row"><div className="goal-label"><strong>{label}</strong><span>{number(registrados)} / {number(meta)} · vence {date(fecha, true)}</span></div><div className="goal-track"><i className={progress < 50 ? 'low' : ''} style={{ width: `${progress}%` }} /></div><b>{progress.toLocaleString('es-CO', { maximumFractionDigits: 1 })}%</b></div>; }
