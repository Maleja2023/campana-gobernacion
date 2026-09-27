import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CircleMarker, GeoJSON, MapContainer, Polygon, Popup, TileLayer, useMap } from 'react-leaflet';
import type { Layer, LeafletEvent } from 'leaflet';
import * as L from 'leaflet';
import { api, type Contorno, type ZonaFeature, type ZonaProperties } from '../api/cliente';
import { Cargando, ErrorEstado } from '../componentes/Estados';
import { useSesion } from '../sesion/SesionContext';
import { colorMunicipio, escalaTintada } from '../mapa/coloresMunicipios';

type Breadcrumb = { id?: number; nombre: string };
type SortKey = 'nombre' | 'simpatizantes';
type Fondo = 'calles' | 'claro' | 'sinfondo';
type ModoColor = 'municipios' | 'presencia';

const TILE_URL_CALLES = import.meta.env.VITE_TILES_URL ?? 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
// CARTO Positron: proveedor gratuito de teselas "claras", sin necesidad de API key.
const TILE_URL_CLARO = import.meta.env.VITE_TILES_URL_CLARO ?? 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
const ATRIBUCION_OSM = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const ATRIBUCION_CARTO = `${ATRIBUCION_OSM} &copy; <a href="https://carto.com/attributions">CARTO</a>`;
const MARGEN_CONTORNO = 0.06;
// Margen para el ajuste de zoom y para el límite de desplazamiento (maxBounds)
// al entrar a un municipio; es una fracción del tamaño de sus propios bounds
// (L.LatLngBounds.pad), por eso funciona igual de bien con municipios grandes
// (Solano) o pequeños (Morelia).
const MARGEN_MUNICIPIO_AJUSTE = 0.08;
const MARGEN_MUNICIPIO_LIMITE = 0.14;

const ESCALA_PRESENCIA = ['#e8ece7', '#c7dfce', '#91c9a7', '#5aaa83', '#2e7c68', '#155448'];

function formatNumber(v: number | null | undefined) {
  return new Intl.NumberFormat('es-CO').format(Number(v ?? 0));
}

function palabraSimpatizantes(n: number) {
  return n === 1 ? 'simpatizante' : 'simpatizantes';
}

function conSimpatizantes(n: number) {
  return `${formatNumber(n)} ${palabraSimpatizantes(n)}`;
}

/** Nivel 0 (sin registros) a 5 (máximo) dentro de la escala de color de presencia. */
function nivelDeValor(v: number, step: number) {
  if (!v) return 0;
  if (v <= step) return 1;
  if (v <= step * 2) return 2;
  if (v <= step * 3) return 3;
  if (v <= step * 4) return 4;
  return 5;
}

function contornoBounds(contorno: Contorno, margen: number) {
  const [minLon, minLat, maxLon, maxLat] = contorno.bbox;
  return L.latLngBounds([minLat - margen, minLon - margen], [maxLat + margen, maxLon + margen]);
}

/** Límites duros del mapa: no se puede desplazar ni alejar fuera del Caquetá. */
function LimitesDepartamento({ contorno }: { contorno: Contorno }) {
  const map = useMap();
  useEffect(() => {
    const bounds = contornoBounds(contorno, 0.08);
    map.setMaxBounds(bounds);
    map.setMinZoom(Math.max(8, map.getBoundsZoom(bounds, false)));
  }, [contorno, map]);
  return null;
}

/** Límites duros del mapa al entrar a un municipio: no se puede desplazar ni
 * alejar fuera de su propia extensión (vista de municipio aislado). */
function LimitesMunicipio({ municipio }: { municipio: ZonaFeature }) {
  const map = useMap();
  useEffect(() => {
    const bounds = new L.GeoJSON(municipio.geometry as never).getBounds().pad(MARGEN_MUNICIPIO_LIMITE);
    map.setMaxBounds(bounds);
    map.setMinZoom(map.getBoundsZoom(bounds, false));
  }, [municipio, map]);
  return null;
}

/** Anillos exteriores de un Polygon o MultiPolygon, en [lat, lon] para Leaflet. */
function anillosExteriores(geometry: GeoJSON.Geometry): [number, number][][] {
  if (geometry.type === 'Polygon') {
    return [geometry.coordinates[0].map(([lon, lat]) => [lat, lon] as [number, number])];
  }
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.map((poligono) => poligono[0].map(([lon, lat]) => [lat, lon] as [number, number]));
  }
  return [];
}

/** Máscara neutra y casi opaca sobre todo lo que queda fuera de `geometry`, con
 * su contorno resaltado. Se usa tanto para el departamento completo como,
 * aislada, para un solo municipio (Polygon o MultiPolygon en ambos casos). */
function Mascara({ geometry }: { geometry: GeoJSON.Geometry }) {
  const huecos = anillosExteriores(geometry);
  if (huecos.length === 0) {
    return <GeoJSON data={geometry as never} pathOptions={{ color: '#e8bd68', weight: 3, fill: false }} />;
  }
  const mundo: [number, number][] = [
    [-90, -180],
    [-90, 180],
    [90, 180],
    [90, -180],
    [-90, -180],
  ];
  return (
    <>
      <Polygon positions={[mundo, ...huecos]} pathOptions={{ stroke: false, fillColor: '#c7cbc3', fillOpacity: 0.88, fillRule: 'evenodd' }} />
      <GeoJSON data={geometry as never} pathOptions={{ color: '#e8bd68', weight: 3, fill: false }} />
    </>
  );
}

/** Al entrar o salir de pantalla completa el contenedor cambia de tamaño sin
 * que el navegador dispare el evento "resize" de la ventana, así que Leaflet
 * no recalcula el lienzo por su cuenta: hay que pedírselo explícitamente. */
function InvalidarTamano({ pantallaCompleta }: { pantallaCompleta: boolean }) {
  const map = useMap();
  useEffect(() => {
    const id = window.setTimeout(() => map.invalidateSize(), 60);
    return () => window.clearTimeout(id);
  }, [pantallaCompleta, map]);
  return null;
}

/** Vista inicial: ajusta al contorno completo del departamento. Al entrar a un
 * municipio, ajusta a SU extensión (no a la de sus subdivisiones, que puede
 * ser más chica si hay veredas sin cartografía) y se mantiene fija mientras
 * se siga navegando dentro de ese mismo municipio. */
function AjustarVista({ contorno, municipioActual, enRaiz }: { contorno: Contorno; municipioActual: ZonaFeature | undefined; enRaiz: boolean }) {
  const map = useMap();
  useEffect(() => {
    if (enRaiz) {
      map.fitBounds(contornoBounds(contorno, MARGEN_CONTORNO), { maxZoom: 13 });
      return;
    }
    if (!municipioActual) return;
    const bounds = new L.GeoJSON(municipioActual.geometry as never).getBounds().pad(MARGEN_MUNICIPIO_AJUSTE);
    if (bounds.isValid()) map.fitBounds(bounds, { maxZoom: 15 });
  }, [contorno, municipioActual, enRaiz, map]);
  return null;
}

const FONDOS: { clave: Fondo; etiqueta: string }[] = [
  { clave: 'calles', etiqueta: 'Calles' },
  { clave: 'claro', etiqueta: 'Claro' },
  { clave: 'sinfondo', etiqueta: 'Sin fondo' },
];

export function MapaPage() {
  const { tienePermiso } = useSesion();
  const puedeVerSimpatizantes = tienePermiso('SIMPATIZANTE_VER');

  const [padre, setPadre] = useState<number>();
  const [crumbs, setCrumbs] = useState<Breadcrumb[]>([{ nombre: 'Caquetá' }]);
  const [puestosVisibles, setPuestosVisibles] = useState(false);
  const [selected, setSelected] = useState<ZonaFeature | null>(null);
  const [mostrarSimpatizantes, setMostrarSimpatizantes] = useState(false);
  const [sort, setSort] = useState<SortKey>('simpatizantes');
  const [asc, setAsc] = useState(false);
  const [paginaSimpatizantes, setPaginaSimpatizantes] = useState(1);
  const [fondo, setFondo] = useState<Fondo>('claro');
  const [modoColor, setModoColor] = useState<ModoColor>('municipios');
  const [pantallaCompleta, setPantallaCompleta] = useState(false);
  const marcoRef = useRef<HTMLDivElement>(null);

  const enRaiz = padre === undefined;
  const mapa = useQuery({ queryKey: ['territorio', padre], queryFn: () => api.mapa(padre) });
  const contorno = useQuery({ queryKey: ['contorno'], queryFn: api.contorno });
  // Geometría de los municipios (se pide siempre; en la raíz comparte caché
  // con `mapa` porque usa la misma clave). Sirve para aislar la vista de un
  // municipio (máscara y límites propios) sin depender de sus subdivisiones.
  const municipiosGeo = useQuery({ queryKey: ['territorio', undefined], queryFn: () => api.mapa() });
  // Catálogo público con el código DANE de cada municipio, para el color fijo por municipio.
  const municipiosCatalogo = useQuery({ queryKey: ['territorio', 'municipios-catalogo'], queryFn: api.municipios });
  const codigoPorMunicipioId = useMemo(
    () => new Map((municipiosCatalogo.data ?? []).map((m) => [m.id, m.codigo_oficial])),
    [municipiosCatalogo.data],
  );

  const features = mapa.data?.features ?? [];
  const municipioLevel = features.some((f) => f.properties.tipo === 'MUNICIPIO');
  const municipioId = selected?.properties.tipo === 'MUNICIPIO' ? selected.id : undefined;
  const puestos = useQuery({ queryKey: ['puestos', municipioId], queryFn: () => api.puestos(municipioId!), enabled: puestosVisibles && municipioId !== undefined });
  const simpatizantes = useQuery({
    queryKey: ['simpatizantes', selected?.id, paginaSimpatizantes],
    queryFn: () => api.simpatizantes(selected!.id, paginaSimpatizantes),
    enabled: puedeVerSimpatizantes && mostrarSimpatizantes && selected !== null,
  });

  const max = Math.max(...features.map((f) => Number(f.properties.simpatizantes ?? 0)), 0);
  const step = max / 5 || 1;
  const total = mapa.data?.totalSimpatizantes ?? features.reduce((s, f) => s + Number(f.properties.simpatizantes ?? 0), 0);
  const dibujado = features.reduce((s, f) => s + Number(f.properties.simpatizantes ?? 0), 0);
  const sinPoligono = Math.max(0, total - dibujado);
  const ordered = useMemo(
    () =>
      [...features].sort((a, b) => {
        const av = sort === 'nombre' ? a.properties.nombre : Number(a.properties.simpatizantes ?? 0);
        const bv = sort === 'nombre' ? b.properties.nombre : Number(b.properties.simpatizantes ?? 0);
        const r = typeof av === 'string' ? av.localeCompare(String(bv), 'es') : av - Number(bv);
        return asc ? r : -r;
      }),
    [features, sort, asc],
  );
  // El municipio dentro del cual estamos navegando (aunque estemos varios
  // niveles más abajo, p. ej. en una vereda): fija la vista aislada de §1 y
  // el tono de la escala de presencia de §2.
  const municipioActualId = crumbs[1]?.id;
  const municipioActual = ((municipiosGeo.data?.features ?? []) as ZonaFeature[]).find((f) => f.id === municipioActualId);
  const colorMunicipioActual = municipioActual ? colorMunicipio(codigoPorMunicipioId.get(municipioActual.id)) : undefined;
  const escalaActual = !enRaiz && colorMunicipioActual ? escalaTintada(colorMunicipioActual) : ESCALA_PRESENCIA;
  const mostrarLeyendaMunicipios = enRaiz && modoColor === 'municipios';

  useEffect(() => {
    const onChange = () => setPantallaCompleta(document.fullscreenElement === marcoRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  function alternarPantallaCompleta() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void marcoRef.current?.requestFullscreen();
  }

  function enter(feature: ZonaFeature) {
    setSelected(feature);
    setMostrarSimpatizantes(false);
    setPaginaSimpatizantes(1);
    if ((feature.properties.subdivisiones ?? 0) > 0) {
      setPadre(feature.id);
      setCrumbs([...crumbs, { id: feature.id, nombre: feature.properties.nombre }]);
      setPuestosVisibles(false);
    }
  }

  function go(index: number) {
    const item = crumbs[index];
    setCrumbs(crumbs.slice(0, index + 1));
    setPadre(item.id);
    setSelected(null);
    setPuestosVisibles(false);
  }

  function irACaqueta() {
    setPadre(undefined);
    setCrumbs([{ nombre: 'Caquetá' }]);
    setSelected(null);
    setPuestosVisibles(false);
  }

  /** En la raíz con modo "Municipios": color propio y fijo por municipio.
   * En cualquier otro caso: mapa de calor de presencia (tintado con el color
   * del municipio actual cuando estamos dentro de uno). */
  function colorDeFeature(feature: ZonaFeature) {
    if (enRaiz && modoColor === 'municipios') return colorMunicipio(codigoPorMunicipioId.get(feature.id));
    return escalaActual[nivelDeValor(Number(feature.properties.simpatizantes ?? 0), step)];
  }

  function style(feature?: GeoJSON.Feature<GeoJSON.Geometry, ZonaProperties>) {
    const modoMunicipios = enRaiz && modoColor === 'municipios';
    return {
      fillColor: feature ? colorDeFeature(feature as ZonaFeature) : '#e8ece7',
      color: modoMunicipios ? '#173331' : '#f7faf5',
      weight: modoMunicipios ? 1 : 1.2,
      fillOpacity: 0.82,
    };
  }

  function each(feature: ZonaFeature, layer: Layer) {
    const cantidad = Number(feature.properties.simpatizantes ?? 0);
    if (enRaiz) {
      const nombreSolo = feature.properties.nombre;
      layer.bindTooltip(nombreSolo, { permanent: true, direction: 'center', className: 'municipio-label' });
      layer.on({
        mouseover: (e: LeafletEvent) => {
          e.target.setStyle({ weight: 3, color: '#f4c95d', fillOpacity: 0.96 });
          e.target.bringToFront();
          e.target.setTooltipContent(`<strong>${nombreSolo}</strong><br />${conSimpatizantes(cantidad)}`);
        },
        mouseout: (e: LeafletEvent) => {
          e.target.setStyle(style(feature));
          e.target.setTooltipContent(nombreSolo);
        },
        click: () => enter(feature),
      });
    } else {
      layer.bindTooltip(`<strong>${feature.properties.nombre}</strong><br />${conSimpatizantes(cantidad)}`, { sticky: true });
      layer.on({
        mouseover: (e: LeafletEvent) => {
          e.target.setStyle({ weight: 3, color: '#f4c95d', fillOpacity: 0.96 });
          e.target.bringToFront();
        },
        mouseout: (e: LeafletEvent) => e.target.setStyle(style(feature)),
        click: () => enter(feature),
      });
    }
  }

  const tileUrl = fondo === 'calles' ? TILE_URL_CALLES : TILE_URL_CLARO;
  const atribucion = fondo === 'calles' ? ATRIBUCION_OSM : ATRIBUCION_CARTO;

  return (
    <main className="page-content mapa-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Inteligencia territorial</p>
          <h1>Mapa de presencia</h1>
        </div>
        <span className="permission-note">Datos según tu territorio</span>
      </div>
      <nav className="breadcrumbs" aria-label="Ruta territorial">
        {crumbs.map((c, i) => (
          <span key={`${c.nombre}-${i}`}>
            <button type="button" disabled={i === crumbs.length - 1} onClick={() => go(i)}>
              {c.nombre}
            </button>
            {i < crumbs.length - 1 && ' / '}
          </span>
        ))}
      </nav>
      {(mapa.isPending || contorno.isPending) && <Cargando texto="Cargando territorio..." />}
      {mapa.isError && <ErrorEstado mensaje={mapa.error.message} reintentar={() => void mapa.refetch()} />}
      {mapa.data && contorno.data && (
        <section className="map-workspace">
          <div className="map-frame" ref={marcoRef}>
            <MapContainer center={[1.614, -75.606]} zoom={8} scrollWheelZoom maxBoundsViscosity={1} className="territory-map" aria-label="Mapa territorial interactivo">
              {fondo !== 'sinfondo' && <TileLayer key={fondo} attribution={atribucion} url={tileUrl} />}
              <InvalidarTamano pantallaCompleta={pantallaCompleta} />
              {enRaiz ? (
                <>
                  <LimitesDepartamento contorno={contorno.data} />
                  <Mascara geometry={contorno.data.geojson} />
                </>
              ) : (
                municipioActual && (
                  <>
                    <LimitesMunicipio municipio={municipioActual} />
                    <Mascara geometry={municipioActual.geometry} />
                  </>
                )
              )}
              <AjustarVista contorno={contorno.data} municipioActual={municipioActual} enRaiz={enRaiz} />
              <GeoJSON key={`${padre ?? 'root'}-${max}-${modoColor}`} data={mapa.data as never} style={style} onEachFeature={each as never} />
              {puestosVisibles &&
                puestos.data?.map(
                  (p) =>
                    p.lat !== null &&
                    p.lon !== null && (
                      <CircleMarker
                        key={p.id}
                        center={[p.lat, p.lon]}
                        radius={Math.max(5, Math.min(18, 5 + Number(p.simpatizantes ?? 0) / 20))}
                        pathOptions={{ color: '#f4c95d', fillColor: '#e58b45', fillOpacity: 0.88 }}
                      >
                        <Popup>
                          <strong>{p.nombre}</strong>
                          <br />
                          {conSimpatizantes(Number(p.simpatizantes ?? 0))}
                          {p.potencial_electoral ? (
                            <>
                              <br />
                              Cobertura: {p.cobertura_pct ?? 0}%
                            </>
                          ) : null}
                        </Popup>
                      </CircleMarker>
                    ),
                )}
            </MapContainer>
            <div className="map-controls top-right">
              <button type="button" className="map-control-button" onClick={irACaqueta} title="Ver todo el Caquetá" aria-label="Ver todo el Caquetá">
                ⌂
              </button>
              <button
                type="button"
                className="map-control-button"
                onClick={alternarPantallaCompleta}
                title={pantallaCompleta ? 'Salir de pantalla completa' : 'Pantalla completa'}
                aria-label={pantallaCompleta ? 'Salir de pantalla completa' : 'Pantalla completa'}
              >
                {pantallaCompleta ? '⤡' : '⤢'}
              </button>
            </div>
            <div className="basemap-selector bottom-left">
              {FONDOS.map((f) => (
                <button key={f.clave} type="button" className={fondo === f.clave ? 'selected' : ''} onClick={() => setFondo(f.clave)}>
                  {f.etiqueta}
                </button>
              ))}
            </div>
          </div>
          <aside className="map-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Lectura rápida</p>
                <h2>Zonas del nivel</h2>
              </div>
              <div className="total-badge-wrap">
                <strong className="total-badge">{formatNumber(total)}</strong>
                <small>{palabraSimpatizantes(total)}</small>
              </div>
            </div>
            {enRaiz && (
              <div className="mode-selector" role="group" aria-label="Modo de color">
                <button type="button" className={modoColor === 'municipios' ? 'selected' : ''} onClick={() => setModoColor('municipios')}>
                  Municipios
                </button>
                <button type="button" className={modoColor === 'presencia' ? 'selected' : ''} onClick={() => setModoColor('presencia')}>
                  Presencia
                </button>
              </div>
            )}
            {municipioLevel && (
              <label className="toggle-row">
                <span>
                  <strong>Puestos de votación</strong>
                  <small>Ver capacidad y cobertura</small>
                </span>
                <input type="checkbox" checked={puestosVisibles} onChange={(e) => setPuestosVisibles(e.target.checked)} />
              </label>
            )}
            <div className="table-wrap">
              <table>
                <caption className="sr-only">Zonas territoriales y simpatizantes</caption>
                <thead>
                  <tr>
                    <th>
                      <button
                        type="button"
                        onClick={() => {
                          setSort('nombre');
                          setAsc(sort === 'nombre' ? !asc : true);
                        }}
                      >
                        Zona ↕
                      </button>
                    </th>
                    <th>
                      <button
                        type="button"
                        onClick={() => {
                          setSort('simpatizantes');
                          setAsc(sort === 'simpatizantes' ? !asc : false);
                        }}
                      >
                        Simpatizantes ↕
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {ordered.map((f) => (
                    <tr key={f.id} tabIndex={0} onClick={() => enter(f)} onKeyDown={(e) => e.key === 'Enter' && enter(f)}>
                      <td>
                        <i className="zone-swatch" style={{ backgroundColor: colorDeFeature(f) }} />
                        {f.properties.nombre}
                      </td>
                      <td>{formatNumber(f.properties.simpatizantes)}</td>
                    </tr>
                  ))}
                  {sinPoligono > 0 && (
                    <tr className="no-map-row">
                      <td colSpan={2}>
                        <strong>Zonas sin polígono</strong>
                        <small>{conSimpatizantes(sinPoligono)} en zonas sin cartografía.</small>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {mostrarLeyendaMunicipios ? (
              <div className="legend legend-municipios">
                <span>Municipios</span>
                <ul className="legend-municipios-list">
                  {ordered.map((f) => (
                    <li key={f.id}>
                      <i style={{ backgroundColor: colorMunicipio(codigoPorMunicipioId.get(f.id)) }} />
                      {f.properties.nombre}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="legend">
                <span>Intensidad de presencia</span>
                <div className="legend-swatches">
                  {[0, 1, 2, 3, 4, 5].map((i) => (
                    <i key={i} style={{ backgroundColor: escalaActual[i] }} />
                  ))}
                </div>
                <small>
                  Sin registros <span>Más registros</span>
                </small>
              </div>
            )}
            {selected && puedeVerSimpatizantes && (
              <div className="selection-note">
                <strong>{selected.properties.nombre}</strong>
                <span>{conSimpatizantes(Number(selected.properties.simpatizantes ?? 0))}</span>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    setMostrarSimpatizantes(true);
                    setPaginaSimpatizantes(1);
                  }}
                >
                  Ver simpatizantes ({formatNumber(selected.properties.simpatizantes)})
                </button>
                <a href={`/simpatizantes?territorioId=${selected.id}`}>Ver todos en Simpatizantes</a>
                {mostrarSimpatizantes && simpatizantes.data && (
                  <div className="people-list">
                    {simpatizantes.data.datos.map((persona) => (
                      <div key={persona.persona_id}>
                        <strong>
                          {persona.nombres} {persona.apellidos}
                        </strong>
                        <small>
                          {persona.territorio_residencia} · {persona.referido_por} · {persona.capturado_en}
                        </small>
                      </div>
                    ))}
                    {simpatizantes.data.total > paginaSimpatizantes * 20 && (
                      <button type="button" onClick={() => setPaginaSimpatizantes(paginaSimpatizantes + 1)}>
                        Siguiente página
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </aside>
        </section>
      )}
    </main>
  );
}
