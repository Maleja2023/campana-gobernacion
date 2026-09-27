import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  api,
  type EstadoProyeccion,
  type FilaCalidad,
  type FiltrosReporte,
  type FilaProyeccion,
  type FilaReporteLider,
  type FilaReporteMunicipio,
  type FilaReportePuesto,
  type TipoReporte,
} from '../api/cliente';
import { Cargando, ErrorEstado } from '../componentes/Estados';
import { Icono } from '../componentes/Icono';
import { useSesion } from '../sesion/SesionContext';
import { guardarArchivo } from '../util/descarga';
import { nombrePropio } from '../util/nombres';

type Tab = TipoReporte | 'BITACORA';

const numero = new Intl.NumberFormat('es-CO');
const n = (v: number | string | null | undefined) => (v === null || v === undefined ? '—' : numero.format(Number(v)));
const pct = (v: number | string | null | undefined) =>
  v === null || v === undefined ? '—' : `${Number(v).toLocaleString('es-CO', { maximumFractionDigits: 1 })} %`;
const fecha = (v: string | null | undefined) => (v ? new Date(v.length === 10 ? `${v}T12:00:00` : v).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

const CARGO: Record<string, string> = { COORDINADOR: 'Coordinador', LIDER: 'Líder', SUBLIDER: 'Sublíder' };

export const ESTADOS_PROYECCION: Record<EstadoProyeccion, { etiqueta: string; clase: string }> = {
  CUMPLIDA: { etiqueta: 'Cumplida', clase: 'estado-activo' },
  EN_CAMINO: { etiqueta: 'En camino', clase: 'estado-activo' },
  EN_RIESGO: { etiqueta: 'En riesgo', clase: 'severidad-media' },
  NO_ALCANZA: { etiqueta: 'No alcanza', clase: 'severidad-alta' },
  VENCIDA: { etiqueta: 'Vencida', clase: 'severidad-alta' },
};

export function ReportesPage() {
  const { tienePermiso } = useSesion();
  const puedeExportar = tienePermiso('EXPORTAR');
  const verBitacora = tienePermiso('USUARIO_GESTIONAR');
  const [tab, setTab] = useState<Tab>('MUNICIPIOS');
  const [filtros, setFiltros] = useState<FiltrosReporte>({});
  const [motivo, setMotivo] = useState<string | null>(null);
  const [exportando, setExportando] = useState(false);
  const [mensaje, setMensaje] = useState<{ tipo: 'ok' | 'error'; texto: string }>();
  const municipios = useQuery({ queryKey: ['municipios'], queryFn: api.municipios });
  const miembros = useQuery({ queryKey: ['mapa', 'miembros'], queryFn: api.mapaMiembros, enabled: tienePermiso('MAPA_VER') });

  const pestanas: [Tab, string][] = [
    ['MUNICIPIOS', 'Por municipio'],
    ['LIDERES', 'Por líder'],
    ['PUESTOS', 'Por puesto'],
    ['PROYECCION', 'Proyección de metas'],
    ['CALIDAD', 'Calidad por líder'],
    ...(verBitacora ? ([['BITACORA', 'Bitácora de exportes']] as [Tab, string][]) : []),
  ];

  async function exportar() {
    if (tab === 'BITACORA' || motivo === null) return;
    const nota = motivo.trim();
    if (nota.length < 5) {
      setMensaje({ tipo: 'error', texto: 'Escriba un motivo de al menos 5 caracteres.' });
      return;
    }
    setExportando(true);
    setMensaje(undefined);
    try {
      const blob = await api.exportarReporte({ ...filtros, reporte: tab, motivo: nota });
      guardarArchivo(blob, `reporte-${tab.toLowerCase()}.xlsx`);
      setMotivo(null);
      setMensaje({ tipo: 'ok', texto: 'Reporte descargado. La exportación quedó registrada con su usuario, la fecha y el motivo.' });
    } catch (causa) {
      setMensaje({ tipo: 'error', texto: causa instanceof Error ? causa.message : 'No fue posible exportar.' });
    } finally {
      setExportando(false);
    }
  }

  const conFiltros = tab === 'MUNICIPIOS' || tab === 'LIDERES' || tab === 'PUESTOS' || tab === 'CALIDAD';

  return (
    <main className="page-content reportes-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Tablero y reportes</p>
          <h1>Reportes</h1>
          <p className="dashboard-subtitle">Avance por municipio, puesto y líder, y la proyección de cada meta. Solo con los datos de tu alcance.</p>
        </div>
        {puedeExportar && tab !== 'BITACORA' && (
          <button type="button" className="secondary-button" onClick={() => setMotivo(motivo === null ? '' : null)}>
            <Icono nombre="descargar" tamano={16} /> Exportar a Excel
          </button>
        )}
      </div>

      {motivo !== null && tab !== 'BITACORA' && (
        <form
          className="dashboard-block exportar-motivo"
          onSubmit={(e) => {
            e.preventDefault();
            void exportar();
          }}
        >
          <label>
            ¿Para qué exporta este reporte?
            <input value={motivo} onChange={(e) => setMotivo(e.target.value)} minLength={5} maxLength={500} placeholder="Ejemplo: informe semanal al comité" autoFocus required />
          </label>
          <small className="helper">Queda registrado con su usuario, la fecha y el número de filas, en la bitácora de exportaciones.</small>
          <div className="form-actions">
            <button type="submit" className="primary-button" disabled={exportando}>
              {exportando ? 'Generando...' : 'Descargar Excel'}
            </button>
            <button type="button" className="secondary-button" onClick={() => setMotivo(null)}>
              Cancelar
            </button>
          </div>
        </form>
      )}
      {mensaje && (
        <div className={mensaje.tipo === 'ok' ? 'form-success' : 'form-error'} role={mensaje.tipo === 'ok' ? 'status' : 'alert'}>
          {mensaje.texto}
        </div>
      )}

      <nav className="agenda-tabs" role="tablist" aria-label="Reportes">
        {pestanas.map(([clave, etiqueta]) => (
          <button key={clave} type="button" role="tab" aria-selected={tab === clave} className={tab === clave ? 'active' : ''} onClick={() => setTab(clave)}>
            {etiqueta}
          </button>
        ))}
      </nav>

      {conFiltros && (
        <section className="filtros-mapa" aria-label="Filtros del reporte">
          <label>
            Municipio
            <select value={filtros.municipioId ?? ''} onChange={(e) => setFiltros({ ...filtros, municipioId: e.target.value ? Number(e.target.value) : undefined })}>
              <option value="">Todos</option>
              {municipios.data?.map((m) => (
                <option key={m.id} value={m.id}>
                  {nombrePropio(m.nombre)}
                </option>
              ))}
            </select>
          </label>
          {tab !== 'MUNICIPIOS' && miembros.data && (
            <label>
              Red de
              <select value={filtros.miembroId ?? ''} onChange={(e) => setFiltros({ ...filtros, miembroId: e.target.value || undefined })}>
                <option value="">Toda la red visible</option>
                {miembros.data
                  .filter((m) => m.cargo_codigo !== 'SUBLIDER')
                  .map((m) => (
                    <option key={m.miembro_id} value={m.miembro_id}>
                      {CARGO[m.cargo_codigo]}: {nombrePropio(m.nombre)}
                    </option>
                  ))}
              </select>
            </label>
          )}
          <label>
            Desde
            <input type="date" value={filtros.desde ?? ''} max={filtros.hasta} onChange={(e) => setFiltros({ ...filtros, desde: e.target.value || undefined })} />
          </label>
          <label>
            Hasta
            <input type="date" value={filtros.hasta ?? ''} min={filtros.desde} onChange={(e) => setFiltros({ ...filtros, hasta: e.target.value || undefined })} />
          </label>
          {(filtros.municipioId || filtros.miembroId || filtros.desde || filtros.hasta) && (
            <button type="button" className="link-button" onClick={() => setFiltros({})}>
              Quitar filtros
            </button>
          )}
          {tab !== 'CALIDAD' && <small className="helper">"En el periodo" cuenta los registros entre esas fechas; las demás columnas son acumuladas.</small>}
        </section>
      )}

      {tab === 'MUNICIPIOS' && <ReporteMunicipios filtros={filtros} />}
      {tab === 'LIDERES' && <ReporteLideres filtros={filtros} />}
      {tab === 'PUESTOS' && <ReportePuestos filtros={filtros} />}
      {tab === 'PROYECCION' && <ReporteProyeccion />}
      {tab === 'CALIDAD' && <ReporteCalidad filtros={filtros} />}
      {tab === 'BITACORA' && <Bitacora />}
    </main>
  );
}

function Tabla({ query, vacio, children }: { query: { isPending: boolean; isError: boolean; error: Error | null; refetch: () => unknown; data?: unknown[] }; vacio: string; children: ReactNode }) {
  if (query.isPending) return <Cargando texto="Calculando reporte..." />;
  if (query.isError) return <ErrorEstado mensaje={query.error?.message ?? 'No fue posible cargar el reporte.'} reintentar={() => void query.refetch()} />;
  if (!query.data?.length) return <div className="empty-inline">{vacio}</div>;
  return (
    <section className="dashboard-block">
      <div className="table-wrap tabla-reporte">
        <table>{children}</table>
      </div>
    </section>
  );
}

function Barra({ valor }: { valor: string | number | null }) {
  if (valor === null) return <span className="texto-tenue">Sin meta</span>;
  const v = Math.max(0, Math.min(100, Number(valor)));
  return (
    <span className="avance">
      <span className="goal-track">
        <i className={v < 50 ? 'low' : ''} style={{ width: `${v}%` }} />
      </span>
      <b>{pct(valor)}</b>
    </span>
  );
}

function ReporteMunicipios({ filtros }: { filtros: FiltrosReporte }) {
  const q = useQuery({ queryKey: ['reporte', 'municipios', filtros], queryFn: () => api.reporteMunicipios(filtros) });
  const filas: FilaReporteMunicipio[] = q.data ?? [];
  const total = (k: keyof FilaReporteMunicipio) => filas.reduce((s, f) => s + Number(f[k] ?? 0), 0);
  return (
    <Tabla query={q} vacio="No hay municipios en tu alcance.">
      <thead>
        <tr>
          <th>Municipio</th>
          <th className="num">Simpatizantes</th>
          <th className="num">En el periodo</th>
          <th className="num">7 días</th>
          <th>Avance de la meta</th>
          <th className="num">Líderes activos</th>
          <th className="num">Necesidades</th>
          <th className="num">Puestos</th>
          <th className="num">Cobertura</th>
        </tr>
      </thead>
      <tbody>
        {filas.map((f) => (
          <tr key={f.municipio_id}>
            <td>
              <strong>{nombrePropio(f.municipio)}</strong>
              {f.meta ? <small>Meta: {n(f.meta)}</small> : null}
            </td>
            <td className="num">{n(f.simpatizantes)}</td>
            <td className="num">{n(f.en_rango)}</td>
            <td className="num">{n(f.ultimos_7_dias)}</td>
            <td>
              <Barra valor={f.avance_pct} />
            </td>
            <td className="num">
              {n(f.lideres_activos_semana)} <small className="texto-tenue">de {n(f.lideres)}</small>
            </td>
            <td className="num">{n(f.necesidades)}</td>
            <td className="num">{n(f.puestos)}</td>
            <td className="num">{f.potencial_electoral ? pct(f.cobertura_pct) : <span className="texto-tenue">Sin potencial</span>}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td>Total</td>
          <td className="num">{n(total('simpatizantes'))}</td>
          <td className="num">{n(total('en_rango'))}</td>
          <td className="num">{n(total('ultimos_7_dias'))}</td>
          <td />
          <td className="num">
            {n(total('lideres_activos_semana'))} <small className="texto-tenue">de {n(total('lideres'))}</small>
          </td>
          <td className="num">{n(total('necesidades'))}</td>
          <td className="num">{n(total('puestos'))}</td>
          <td />
        </tr>
      </tfoot>
    </Tabla>
  );
}

function ReporteLideres({ filtros }: { filtros: FiltrosReporte }) {
  const q = useQuery({ queryKey: ['reporte', 'lideres', filtros], queryFn: () => api.reporteLideres(filtros) });
  const filas: FilaReporteLider[] = q.data ?? [];
  return (
    <Tabla query={q} vacio="No hay líderes en tu alcance con estos filtros.">
      <thead>
        <tr>
          <th>Nombre</th>
          <th>Municipio</th>
          <th className="num">Su red</th>
          <th className="num">En el periodo</th>
          <th className="num">7 días</th>
          <th className="num">30 días</th>
          <th>Último registro</th>
          <th>Meta</th>
          <th className="num">Calidad</th>
        </tr>
      </thead>
      <tbody>
        {filas.map((f) => (
          <tr key={f.miembro_id} className={f.activo ? '' : 'fila-inactiva'}>
            <td>
              <strong>{nombrePropio(f.nombre)}</strong>
              <small>
                {CARGO[f.cargo_codigo] ?? f.cargo_codigo}
                {f.superior ? ` · bajo ${nombrePropio(f.superior)}` : ''}
                {!f.activo && ' · inactivo'}
              </small>
            </td>
            <td>{nombrePropio(f.municipio) || '—'}</td>
            <td className="num">
              {n(f.red)}
              {f.red !== f.propios && <small className="texto-tenue">{n(f.propios)} propios</small>}
            </td>
            <td className="num">{n(f.en_rango)}</td>
            <td className="num">{n(f.ultimos_7_dias)}</td>
            <td className="num">{n(f.ultimos_30_dias)}</td>
            <td>{fecha(f.ultimo_registro)}</td>
            <td>{f.meta ? <Barra valor={f.avance_pct} /> : <span className="texto-tenue">Sin meta</span>}</td>
            <td className="num">
              {f.intentos_duplicado + f.alertas_abiertas === 0 ? (
                <span className="texto-tenue">Sin señales</span>
              ) : (
                <span className="estado-pill severidad-media" title="Intentos de registrar cédulas ya registradas y alertas abiertas">
                  {f.intentos_duplicado} dupl. · {f.alertas_abiertas} alertas
                </span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </Tabla>
  );
}

function ReportePuestos({ filtros }: { filtros: FiltrosReporte }) {
  const q = useQuery({ queryKey: ['reporte', 'puestos', filtros], queryFn: () => api.reportePuestos(filtros) });
  const filas: FilaReportePuesto[] = q.data ?? [];
  const sinPotencial = filas.length > 0 && filas.every((f) => !f.potencial_electoral);
  return (
    <>
      {sinPotencial && (
        <div className="aviso-datos" style={{ marginBottom: 14 }}>
          <strong>Falta el potencial electoral de los puestos</strong>
          <span>Sin él no se puede calcular la cobertura ni cuántos votantes faltan. Cárguelo con el archivo Divipole de la Registraduría (docs/mapas-datos.md).</span>
        </div>
      )}
      <Tabla query={q} vacio="No hay puestos con estos filtros.">
        <thead>
          <tr>
            <th>Puesto</th>
            <th>Municipio</th>
            <th className="num">Simpatizantes</th>
            <th className="num">Potencial</th>
            <th className="num">Cobertura</th>
            <th className="num">Faltan</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f.puesto_id}>
              <td>
                <strong>{nombrePropio(f.puesto)}</strong>
              </td>
              <td>{nombrePropio(f.municipio)}</td>
              <td className="num">{n(f.simpatizantes)}</td>
              <td className="num">{n(f.potencial_electoral)}</td>
              <td className="num">{f.potencial_electoral ? pct(f.cobertura_pct) : '—'}</td>
              <td className="num">{n(f.faltan)}</td>
            </tr>
          ))}
        </tbody>
      </Tabla>
    </>
  );
}

function ReporteProyeccion() {
  const q = useQuery({ queryKey: ['reporte', 'proyeccion'], queryFn: api.proyeccionMetas });
  const filas: FilaProyeccion[] = q.data ?? [];
  const conteo = (e: EstadoProyeccion) => filas.filter((f) => f.estado === e).length;
  return (
    <>
      {filas.length > 0 && (
        <div className="proyeccion-resumen">
          {(['NO_ALCANZA', 'EN_RIESGO', 'EN_CAMINO', 'CUMPLIDA', 'VENCIDA'] as EstadoProyeccion[]).map((e) => (
            <div key={e} className={`proyeccion-cifra ${ESTADOS_PROYECCION[e].clase}`}>
              <strong>{conteo(e)}</strong>
              <span>{ESTADOS_PROYECCION[e].etiqueta}</span>
            </div>
          ))}
        </div>
      )}
      <p className="helper" style={{ margin: '0 0 12px' }}>
        La proyección toma el ritmo de los últimos 14 días y lo extiende hasta la fecha límite. "En riesgo": llegaría a entre el 80 % y el 100 % de la meta.
      </p>
      <Tabla query={q} vacio="No hay metas asignadas en tu alcance.">
        <thead>
          <tr>
            <th>Meta de</th>
            <th className="num">Avance</th>
            <th className="num">Ritmo actual</th>
            <th className="num">Ritmo necesario</th>
            <th className="num">Proyectado</th>
            <th>Cumpliría</th>
            <th>Estado</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <tr key={`${f.tipo}-${f.referencia}-${f.fecha_limite}`}>
              <td>
                <strong>{nombrePropio(f.nombre)}</strong>
                <small>
                  {f.tipo === 'TERRITORIO' ? 'Municipio' : 'Miembro'} · vence {fecha(f.fecha_limite)}
                  {f.dias_restantes >= 0 ? ` (${n(f.dias_restantes)} días)` : ''}
                </small>
              </td>
              <td className="num">
                {n(f.registrados)} <small className="texto-tenue">de {n(f.meta)}</small>
              </td>
              <td className="num">{Number(f.ritmo_diario).toLocaleString('es-CO', { maximumFractionDigits: 1 })} / día</td>
              <td className="num">{f.ritmo_necesario ? `${Number(f.ritmo_necesario).toLocaleString('es-CO', { maximumFractionDigits: 1 })} / día` : '—'}</td>
              <td className="num">
                {n(f.proyectado)} <small className="texto-tenue">{pct(f.proyectado_pct)}</small>
              </td>
              <td>{f.estado === 'CUMPLIDA' ? 'Ya cumplió' : f.fecha_estimada ? fecha(f.fecha_estimada) : 'Sin ritmo'}</td>
              <td>
                <span className={`estado-pill ${ESTADOS_PROYECCION[f.estado].clase}`}>{ESTADOS_PROYECCION[f.estado].etiqueta}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </Tabla>
    </>
  );
}

const NIVEL: Record<FilaCalidad['nivel'], { etiqueta: string; clase: string }> = {
  ALTA: { etiqueta: 'Alta', clase: 'estado-activo' },
  MEDIA: { etiqueta: 'Media', clase: 'severidad-media' },
  BAJA: { etiqueta: 'Baja', clase: 'severidad-alta' },
  SIN_DATOS: { etiqueta: 'Sin registros', clase: '' },
};

function ReporteCalidad({ filtros }: { filtros: FiltrosReporte }) {
  const q = useQuery({ queryKey: ['reporte', 'calidad', filtros.municipioId, filtros.miembroId], queryFn: () => api.reporteCalidad(filtros) });
  return (
    <>
      <details className="chart-alt" style={{ marginBottom: 12 }}>
        <summary>¿Cómo se calcula el puntaje?</summary>
        <ul className="reconocimientos-guia">
          <li>
            <strong>Completitud (40 puntos):</strong> registros con teléfono (15), con puesto de votación (15) y con vereda o barrio, no solo el municipio (10).
          </li>
          <li>
            <strong>Confiabilidad (60 puntos):</strong> baja con los intentos de registrar cédulas que ya tenía otro líder, las personas en alertas abiertas o
            confirmadas (las descartadas no cuentan; pesan el doble) y los registros retirados. Con 10 % de problemas queda en la mitad; con 20 % o más, en cero.
          </li>
          <li>
            <strong>Nivel:</strong> alta desde 80, media de 60 a 79, baja por debajo de 60. Las fechas no aplican: el puntaje mira todos los registros del líder.
          </li>
        </ul>
      </details>
      <Tabla query={q} vacio="No hay líderes en tu alcance con estos filtros.">
        <thead>
          <tr>
            <th>Líder</th>
            <th className="num">Registros</th>
            <th className="num">Con teléfono</th>
            <th className="num">Con puesto</th>
            <th className="num">Con vereda o barrio</th>
            <th className="num">Duplicados</th>
            <th className="num">En alertas</th>
            <th className="num">Retirados</th>
            <th className="num">Puntaje</th>
          </tr>
        </thead>
        <tbody>
          {q.data?.map((f) => (
            <tr key={f.miembro_id}>
              <td>
                <strong>{nombrePropio(f.nombre)}</strong>
                <small>
                  {CARGO[f.cargo_codigo] ?? f.cargo_codigo}
                  {f.municipio ? ` · ${nombrePropio(f.municipio)}` : ''}
                </small>
              </td>
              <td className="num">{n(f.registros)}</td>
              <td className="num">{pct(f.con_telefono_pct)}</td>
              <td className="num">{pct(f.con_puesto_pct)}</td>
              <td className="num">{pct(f.con_zona_pct)}</td>
              <td className="num">{n(f.intentos_duplicado)}</td>
              <td className="num">{n(f.personas_en_alertas)}</td>
              <td className="num">{n(f.retirados)}</td>
              <td className="num">
                <span className={`estado-pill puntaje ${NIVEL[f.nivel].clase}`} title={`Completitud ${f.completitud} de 40 · confiabilidad ${f.confiabilidad} de 60`}>
                  {f.puntaje ?? '—'} · {NIVEL[f.nivel].etiqueta}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </Tabla>
    </>
  );
}

const RECURSOS: Record<string, string> = {
  REPORTE_CALIDAD: 'Calidad por líder',
  SIMPATIZANTES: 'Lista de simpatizantes',
  REPORTE_MUNICIPIOS: 'Reporte por municipio',
  REPORTE_LIDERES: 'Reporte por líder',
  REPORTE_PUESTOS: 'Reporte por puesto',
  REPORTE_PROYECCION: 'Proyección de metas',
};

function Bitacora() {
  const q = useQuery({ queryKey: ['reporte', 'bitacora'], queryFn: api.bitacoraExportaciones });
  return (
    <Tabla query={q} vacio="Todavía no se ha exportado nada.">
      <thead>
        <tr>
          <th>Fecha</th>
          <th>Usuario</th>
          <th>Qué exportó</th>
          <th>Motivo</th>
          <th className="num">Filas</th>
          <th>Municipios</th>
        </tr>
      </thead>
      <tbody>
        {q.data?.map((f) => (
          <tr key={f.id}>
            <td>{new Date(f.exportado_en).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })}</td>
            <td>{f.usuario}</td>
            <td>{RECURSOS[f.recurso] ?? f.recurso}</td>
            <td>{f.motivo}</td>
            <td className="num">{n(f.cantidad_registros)}</td>
            <td>{f.territorios ? nombrePropio(f.territorios) : '—'}</td>
          </tr>
        ))}
      </tbody>
    </Tabla>
  );
}
