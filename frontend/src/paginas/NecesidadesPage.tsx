import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type NecesidadFila } from '../api/cliente';
import { Cargando, ErrorEstado } from '../componentes/Estados';
import { Icono } from '../componentes/Icono';
import { Markdown } from '../componentes/Markdown';
import { useSesion } from '../sesion/SesionContext';
import { nombrePropio } from '../util/nombres';
import { CATEGORIAS_NECESIDAD } from '../util/categorias';

type Tab = 'resumen' | 'listado' | 'informe';

const numero = new Intl.NumberFormat('es-CO');
const nombreCategoria = (c: string | null) => (c ? (CATEGORIAS_NECESIDAD[c] ?? (c === 'SIN_CLASIFICAR' ? 'Sin clasificar' : c)) : 'Sin clasificar');
const FUENTE: Record<string, string> = { ORIGEN: 'Categoría asignada', IA: 'Clasificada con IA', REGLAS: 'Clasificada por palabras clave' };

export function NecesidadesPage() {
  const { tienePermiso } = useSesion();
  const puedeGestionar = tienePermiso('AGENDA_GESTIONAR');
  const [tab, setTab] = useState<Tab>('resumen');
  const [municipioId, setMunicipioId] = useState<number>();
  const estado = useQuery({ queryKey: ['necesidades', 'estado'], queryFn: api.necesidadesEstado });

  return (
    <main className="page-content necesidades-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Voz del territorio</p>
          <h1>Necesidades del territorio</h1>
          <p className="dashboard-subtitle">Lo que la gente pide en cada vereda y barrio, clasificado por tema, y el informe por municipio para el programa de gobierno.</p>
        </div>
      </div>

      {estado.data && <EstadoIa estado={estado.data} puedeGestionar={puedeGestionar} />}
      {estado.isError && (
        <div className="form-error" role="alert">
          No se pudo consultar el estado de la clasificación: {estado.error.message}
        </div>
      )}

      <nav className="agenda-tabs" role="tablist" aria-label="Secciones">
        {(
          [
            ['resumen', 'Resumen por municipio'],
            ['listado', 'Necesidades reportadas'],
            ['informe', 'Informe por municipio'],
          ] as [Tab, string][]
        ).map(([clave, etiqueta]) => (
          <button key={clave} type="button" role="tab" aria-selected={tab === clave} className={tab === clave ? 'active' : ''} onClick={() => setTab(clave)}>
            {etiqueta}
          </button>
        ))}
      </nav>

      {tab === 'resumen' && (
        <Resumen
          onVerMunicipio={(id) => {
            setMunicipioId(id);
            setTab('informe');
          }}
        />
      )}
      {tab === 'listado' && <Listado puedeGestionar={puedeGestionar} />}
      {tab === 'informe' && <Informe municipioId={municipioId} setMunicipioId={setMunicipioId} />}
    </main>
  );
}

function EstadoIa({ estado, puedeGestionar }: { estado: NonNullable<ReturnType<typeof useQuery<Awaited<ReturnType<typeof api.necesidadesEstado>>>>['data']>; puedeGestionar: boolean }) {
  const cache = useQueryClient();
  const [clasificando, setClasificando] = useState(false);
  const [mensaje, setMensaje] = useState('');
  const sinCategoria = estado.total - estado.con_categoria_origen;
  const hechas = estado.iaDisponible ? estado.clasificadas_modelo : estado.clasificadas_reglas;

  async function clasificar() {
    setClasificando(true);
    setMensaje('');
    try {
      const r = await api.necesidadesClasificar();
      setMensaje(
        r.fallidas
          ? `Se clasificaron ${r.clasificadas}; ${r.fallidas} no se pudieron con IA y quedaron clasificadas por palabras clave mientras tanto.`
          : `Se clasificaron ${r.clasificadas} necesidades.`,
      );
      await cache.invalidateQueries({ queryKey: ['necesidades'] });
    } catch (causa) {
      setMensaje(causa instanceof Error ? causa.message : 'No fue posible clasificar.');
    } finally {
      setClasificando(false);
    }
  }

  return (
    <section className={`estado-ia ${estado.iaDisponible ? 'activa' : ''}`}>
      <Icono nombre="chispa" tamano={20} />
      <div>
        <strong>{estado.iaDisponible ? `Clasificación con inteligencia artificial activa (${estado.modelo})` : 'Inteligencia artificial sin configurar'}</strong>
        <span>
          {estado.iaDisponible
            ? `${numero.format(hechas)} de ${numero.format(sinCategoria)} necesidades sin categoría ya están clasificadas con IA. Las nuevas se clasifican solas cada 10 minutos.`
            : `Las necesidades se clasifican por palabras clave (${numero.format(hechas)} de ${numero.format(sinCategoria)}). Para usar IA y generar informes, configure ANTHROPIC_API_KEY en la API (ver docs/inteligencia-artificial.md).`}
        </span>
        {mensaje && <span className="estado-ia-mensaje">{mensaje}</span>}
      </div>
      {puedeGestionar && (
        <button type="button" className="secondary-button" disabled={clasificando} onClick={() => void clasificar()}>
          {clasificando ? 'Clasificando...' : 'Clasificar ahora'}
        </button>
      )}
    </section>
  );
}

function Resumen({ onVerMunicipio }: { onVerMunicipio: (id: number) => void }) {
  const q = useQuery({ queryKey: ['necesidades', 'resumen'], queryFn: api.necesidadesResumen });
  const { municipios, categorias, maximo } = useMemo(() => {
    const porMunicipio = new Map<number, { id: number; nombre: string; total: number; cat: Map<string, number> }>();
    const totales = new Map<string, number>();
    for (const f of q.data ?? []) {
      if (f.municipio_id === null) continue;
      const m = porMunicipio.get(f.municipio_id) ?? { id: f.municipio_id, nombre: f.municipio ?? '', total: 0, cat: new Map() };
      m.total += f.cantidad;
      m.cat.set(f.categoria, (m.cat.get(f.categoria) ?? 0) + f.cantidad);
      porMunicipio.set(f.municipio_id, m);
      totales.set(f.categoria, (totales.get(f.categoria) ?? 0) + f.cantidad);
    }
    const cats = [...totales].sort((a, b) => b[1] - a[1]).map(([c]) => c);
    const lista = [...porMunicipio.values()].sort((a, b) => b.total - a.total);
    const max = Math.max(1, ...lista.flatMap((m) => [...m.cat.values()]));
    return { municipios: lista, categorias: cats, maximo: max };
  }, [q.data]);

  if (q.isPending) return <Cargando texto="Cargando necesidades..." />;
  if (q.isError) return <ErrorEstado mensaje={q.error.message} reintentar={() => void q.refetch()} />;
  if (!municipios.length) return <div className="empty-inline">No hay necesidades reportadas en tu territorio.</div>;

  return (
    <section className="dashboard-block">
      <div className="block-heading">
        <div>
          <h2>Necesidades por municipio y tema</h2>
          <small style={{ color: 'var(--texto-3)' }}>Más intenso = más reportes. Clic en un municipio para ver o generar su informe.</small>
        </div>
      </div>
      <div className="table-wrap tabla-reporte matriz-necesidades">
        <table>
          <thead>
            <tr>
              <th>Municipio</th>
              <th className="num">Total</th>
              {categorias.map((c) => (
                <th key={c} className="num">
                  {nombreCategoria(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {municipios.map((m) => (
              <tr key={m.id}>
                <td>
                  <button type="button" className="link-button" onClick={() => onVerMunicipio(m.id)}>
                    {nombrePropio(m.nombre)}
                  </button>
                </td>
                <td className="num">
                  <strong>{numero.format(m.total)}</strong>
                </td>
                {categorias.map((c) => {
                  const v = m.cat.get(c) ?? 0;
                  return (
                    <td key={c} className="num celda-calor" style={{ background: v ? `rgba(240, 164, 58, ${0.12 + (0.7 * v) / maximo})` : undefined }}>
                      {v ? numero.format(v) : ''}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Listado({ puedeGestionar }: { puedeGestionar: boolean }) {
  const cache = useQueryClient();
  const [municipioId, setMunicipioId] = useState<number>();
  const [categoria, setCategoria] = useState('');
  const [pagina, setPagina] = useState(1);
  const [error, setError] = useState('');
  const municipios = useQuery({ queryKey: ['municipios'], queryFn: api.municipios });
  const q = useQuery({
    queryKey: ['necesidades', 'listado', municipioId, categoria, pagina],
    queryFn: () => api.necesidadesListado({ municipioId, categoria: categoria || undefined, pagina }),
  });

  async function corregir(n: NecesidadFila, nueva: string) {
    setError('');
    try {
      await api.necesidadCorregir(n.necesidad_id, nueva);
      await cache.invalidateQueries({ queryKey: ['necesidades'] });
    } catch (causa) {
      setError(causa instanceof Error ? causa.message : 'No fue posible corregir la categoría.');
    }
  }

  return (
    <>
      <section className="filtros-mapa">
        <label>
          Municipio
          <select
            value={municipioId ?? ''}
            onChange={(e) => {
              setMunicipioId(e.target.value ? Number(e.target.value) : undefined);
              setPagina(1);
            }}
          >
            <option value="">Todos</option>
            {municipios.data?.map((m) => (
              <option key={m.id} value={m.id}>
                {nombrePropio(m.nombre)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Tema
          <select
            value={categoria}
            onChange={(e) => {
              setCategoria(e.target.value);
              setPagina(1);
            }}
          >
            <option value="">Todos</option>
            {Object.entries(CATEGORIAS_NECESIDAD).map(([c, n]) => (
              <option key={c} value={c}>
                {n}
              </option>
            ))}
            <option value="SIN_CLASIFICAR">Sin clasificar</option>
          </select>
        </label>
        <small className="helper">No se muestra quién reportó cada necesidad.</small>
      </section>
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      {q.isPending && <Cargando texto="Cargando necesidades..." />}
      {q.isError && <ErrorEstado mensaje={q.error.message} reintentar={() => void q.refetch()} />}
      {q.data && q.data.datos.length === 0 && <div className="empty-inline">No hay necesidades con estos filtros.</div>}
      {q.data && q.data.datos.length > 0 && (
        <section className="dashboard-block">
          <ul className="lista-necesidades">
            {q.data.datos.map((n) => (
              <li key={n.necesidad_id}>
                <div>
                  <p>{n.descripcion}</p>
                  <small>
                    {nombrePropio(n.territorio)}
                    {n.municipio && n.municipio !== n.territorio ? ` · ${nombrePropio(n.municipio)}` : ''} ·{' '}
                    {new Date(n.reportada_en).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })}
                    {n.prioridad ? ` · prioridad ${n.prioridad.toLowerCase()}` : ''}
                  </small>
                </div>
                <div className="necesidad-categoria">
                  {puedeGestionar ? (
                    <select value={n.categoria ?? ''} aria-label="Tema" onChange={(e) => e.target.value && void corregir(n, e.target.value)}>
                      {!n.categoria && <option value="">Sin clasificar</option>}
                      {Object.entries(CATEGORIAS_NECESIDAD).map(([c, nombre]) => (
                        <option key={c} value={c}>
                          {nombre}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="insignia insignia-semana">{nombreCategoria(n.categoria)}</span>
                  )}
                  {n.fuente_categoria && (
                    <small title={n.confianza ? `Confianza: ${Math.round(Number(n.confianza) * 100)} %` : undefined}>
                      {FUENTE[n.fuente_categoria]}
                      {n.fuente_categoria !== 'ORIGEN' && n.confianza ? ` · ${Math.round(Number(n.confianza) * 100)} %` : ''}
                    </small>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {q.data.total > q.data.porPagina && (
            <div className="pager">
              <button type="button" disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)}>
                Anterior
              </button>
              <span>
                {(pagina - 1) * q.data.porPagina + 1}–{Math.min(pagina * q.data.porPagina, q.data.total)} de {numero.format(q.data.total)}
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

function Informe({ municipioId, setMunicipioId }: { municipioId?: number; setMunicipioId: (id?: number) => void }) {
  const cache = useQueryClient();
  const { tienePermiso } = useSesion();
  const puedeGenerar = tienePermiso('AGENDA_VER');
  const [error, setError] = useState('');
  const [copiado, setCopiado] = useState(false);
  const municipios = useQuery({ queryKey: ['municipios'], queryFn: api.municipios });
  const q = useQuery({
    queryKey: ['necesidades', 'informe', municipioId],
    queryFn: () => api.necesidadesInforme(municipioId!),
    enabled: municipioId !== undefined,
    // Mientras la IA escribe, se consulta cada 5 segundos.
    refetchInterval: (consulta) => (consulta.state.data?.generando ? 5000 : false),
  });
  const generando = q.data?.generando ?? false;

  useEffect(() => setCopiado(false), [municipioId]);

  async function generar() {
    if (municipioId === undefined) return;
    setError('');
    try {
      const r = await api.necesidadesGenerarInforme(municipioId);
      cache.setQueryData(['necesidades', 'informe', municipioId], r);
    } catch (causa) {
      setError(causa instanceof Error ? causa.message : 'No fue posible generar el informe.');
    }
  }

  const informe = q.data?.informe;
  return (
    <>
      <section className="filtros-mapa no-imprimir">
        <label>
          Municipio
          <select value={municipioId ?? ''} onChange={(e) => setMunicipioId(e.target.value ? Number(e.target.value) : undefined)}>
            <option value="">Seleccione un municipio</option>
            {municipios.data?.map((m) => (
              <option key={m.id} value={m.id}>
                {nombrePropio(m.nombre)}
              </option>
            ))}
          </select>
        </label>
        {municipioId !== undefined && q.data && puedeGenerar && (
          <button type="button" className="primary-button" disabled={!q.data.iaDisponible || generando} onClick={() => void generar()}>
            <Icono nombre="chispa" tamano={16} /> {generando ? 'La IA está escribiendo el informe...' : informe ? 'Generar informe actualizado' : 'Generar informe con IA'}
          </button>
        )}
        {informe && (
          <>
            <button type="button" className="secondary-button" onClick={() => window.print()}>
              Imprimir o guardar PDF
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => void navigator.clipboard.writeText(informe.contenido).then(() => setCopiado(true))}
            >
              {copiado ? 'Copiado' : 'Copiar texto'}
            </button>
          </>
        )}
      </section>
      {municipioId === undefined && <div className="empty-inline">Elija un municipio para ver su informe de necesidades.</div>}
      {q.isPending && municipioId !== undefined && <Cargando texto="Buscando el informe..." />}
      {q.isError && <ErrorEstado mensaje={q.error.message} reintentar={() => void q.refetch()} />}
      {q.data && !q.data.iaDisponible && (
        <div className="aviso-datos">
          <strong>La inteligencia artificial no está configurada</strong>
          <span>Para generar informes, agregue ANTHROPIC_API_KEY en el archivo .env de la API y reiníciela (docs/inteligencia-artificial.md).</span>
        </div>
      )}
      {(error || q.data?.error) && (
        <div className="form-error" role="alert">
          {error || q.data?.error}
        </div>
      )}
      {generando && <Cargando texto="La IA está leyendo las necesidades y escribiendo el informe. Suele tardar entre 30 segundos y 2 minutos." />}
      {q.data && !informe && !generando && q.data.iaDisponible && (
        <div className="empty-inline">Este municipio aún no tiene informe. Genérelo con el botón de arriba.</div>
      )}
      {informe && (
        <article className="dashboard-block informe-ia">
          <header>
            <p className="eyebrow">Insumo para el programa de gobierno</p>
            <h2>Necesidades de {nombrePropio(municipios.data?.find((m) => m.id === municipioId)?.nombre ?? '')}</h2>
            <small>
              Generado el {new Date(informe.generado_en).toLocaleString('es-CO', { dateStyle: 'long', timeStyle: 'short' })} por {informe.generado_por} a partir de{' '}
              {numero.format(informe.total_necesidades)} necesidades · {informe.modelo}. Es un borrador escrito por IA: revíselo antes de usarlo.
            </small>
          </header>
          <Markdown texto={informe.contenido} />
        </article>
      )}
    </>
  );
}
