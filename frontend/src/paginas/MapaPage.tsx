import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CircleMarker, GeoJSON, MapContainer, Polygon, Popup, TileLayer, useMap } from 'react-leaflet';
import type { Layer, LeafletEvent } from 'leaflet';
import * as L from 'leaflet';
import { api, type BrechaPuesto, type FiltrosMapa, type MiembroFiltro, type ZonaFeature, type ZonaProperties } from '../api/cliente';
import { CapaCalor, LEYENDA_CALOR } from '../mapa/CapaCalor';
import { Cargando, ErrorEstado } from '../componentes/Estados';
import { Icono } from '../componentes/Icono';
import { useSesion } from '../sesion/SesionContext';
import { colorMunicipio } from '../mapa/coloresMunicipios';
import { nombrePropio } from '../util/nombres';

type Breadcrumb = { id?: number; nombre: string };
type SortKey = 'nombre' | 'simpatizantes';
type Fondo = 'calles' | 'claro' | 'sinfondo';
type ModoColor = 'municipios' | 'presencia';
type Capa = 'simpatizantes' | 'calor' | 'necesidades' | 'brecha';

const CAPAS: { clave: Capa; etiqueta: string }[] = [
  { clave: 'simpatizantes', etiqueta: 'Simpatizantes' },
  { clave: 'calor', etiqueta: 'Calor' },
  { clave: 'necesidades', etiqueta: 'Necesidades' },
  { clave: 'brecha', etiqueta: 'Brecha electoral' },
];

export const CATEGORIAS_NECESIDAD: Record<string, string> = {
  VIAS: 'Vías',
  AGUA: 'Agua y saneamiento',
  SALUD: 'Salud',
  EDUCACION: 'Educación',
  EMPLEO: 'Empleo',
  SEGURIDAD: 'Seguridad',
  VIVIENDA: 'Vivienda',
  AGRO: 'Agro y desarrollo rural',
  CONECTIVIDAD: 'Conectividad',
  AMBIENTE: 'Ambiente',
  OTRA: 'Otra',
};

// Necesidades: otra tonalidad (ámbar) para no confundirla con la presencia.
const ESCALA_NECESIDADES = ['#f6f1e7', '#fbe3b4', '#f7c877', '#f0a43a', '#d9801f', '#a85a0c'];
const FONDO_NEUTRO = '#eef1f5';

const TILE_URL_CALLES = import.meta.env.VITE_TILES_URL ?? 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
// CARTO Positron: proveedor gratuito de teselas "claras", sin necesidad de API key.
const TILE_URL_CLARO = import.meta.env.VITE_TILES_URL_CLARO ?? 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
const ATRIBUCION_OSM = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const ATRIBUCION_CARTO = `${ATRIBUCION_OSM} &copy; <a href="https://carto.com/attributions">CARTO</a>`;

// Escala secuencial de un solo tono: claro = pocos registros, oscuro = muchos.
const ESCALA_PRESENCIA = ['#eef2f6', '#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#1c5cab'];
const CONTORNO = '#0b1b2e';
const RESALTE = '#0b1b2e';
// Un territorio fuera del alcance del usuario (fuera de
// acceso.territorios_visibles(), migración 20) se dibuja así en cualquier modo
// de color, y nunca muestra su número de simpatizantes.
const COLOR_SIN_ACCESO = '#d5dae1';
const TEXTO_SIN_ACCESO = 'Sin acceso';

const TIPOS: Record<string, string> = {
  MUNICIPIO: 'Municipio',
  COMUNA: 'Comuna',
  CORREGIMIENTO: 'Corregimiento',
  VEREDA: 'Vereda',
  BARRIO: 'Barrio',
  CENTRO_POBLADO: 'Centro poblado',
};

function formatNumber(v: number | null | undefined) {
  return new Intl.NumberFormat('es-CO').format(Number(v ?? 0));
}

function palabraSimpatizantes(n: number) {
  return n === 1 ? 'simpatizante' : 'simpatizantes';
}

function conSimpatizantes(n: number) {
  return `${formatNumber(n)} ${palabraSimpatizantes(n)}`;
}

/** Texto para una cantidad que puede estar oculta por falta de alcance. */
function conSimpatizantesOSinAcceso(n: number | null | undefined, sinAcceso: boolean) {
  return sinAcceso ? TEXTO_SIN_ACCESO : conSimpatizantes(Number(n ?? 0));
}

/** "12 necesidades · principal: Vías" a partir del reparto por categoría. */
function textoNecesidades(porCategoria: Record<string, number> | undefined) {
  const entradas = Object.entries(porCategoria ?? {}).sort((a, b) => b[1] - a[1]);
  const total = entradas.reduce((s, [, n]) => s + n, 0);
  if (!total) return 'Sin necesidades reportadas';
  return `${formatNumber(total)} ${total === 1 ? 'necesidad' : 'necesidades'} · principal: ${CATEGORIAS_NECESIDAD[entradas[0][0]] ?? entradas[0][0]}`;
}

/** Color del puesto según su cobertura: rojo (lejos) a azul (cubierto). */
function colorCobertura(p: BrechaPuesto) {
  if (!p.potencial_electoral) return '#7a8699';
  const c = Number(p.cobertura_pct ?? 0);
  if (c >= 30) return '#1c5cab';
  if (c >= 15) return '#3987e5';
  if (c >= 5) return '#f0a43a';
  return '#d03b3b';
}

/** Nivel 0 (sin registros) a 5 (máximo) dentro de la escala de presencia. */
function nivelDeValor(v: number, step: number) {
  if (!v) return 0;
  return Math.min(5, Math.ceil(v / step));
}

/** Encuadra el mapa en `limites` y no deja salir de ellos. Se recalcula solo
 * cuando cambia `clave` (el territorio que se está viendo). Primero se quitan
 * los límites anteriores: si no, el zoom mínimo del nivel anterior impide
 * encuadrar bien uno más grande (el Caquetá completo) o más pequeño. */
function Encuadre({ limites, clave }: { limites: L.LatLngBounds; clave: string }) {
  const map = useMap();
  useEffect(() => {
    if (!limites.isValid()) return;
    map.invalidateSize();
    map.setMaxBounds(undefined as unknown as L.LatLngBounds);
    map.setMinZoom(0);
    map.fitBounds(limites, { padding: [24, 24], animate: false });
    map.setMinZoom(Math.max(0, map.getZoom() - 0.5));
    map.setMaxBounds(limites.pad(0.35));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave, map]);
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

/** Atenúa todo lo que queda fuera de `geometry` y resalta su contorno. */
function Mascara({ geometry }: { geometry: GeoJSON.Geometry }) {
  const huecos = anillosExteriores(geometry);
  const mundo: [number, number][] = [
    [-90, -180],
    [-90, 180],
    [90, 180],
    [90, -180],
    [-90, -180],
  ];
  return (
    <>
      {huecos.length > 0 && (
        <Polygon positions={[mundo, ...huecos]} interactive={false} pathOptions={{ stroke: false, fillColor: '#e4e8ee', fillOpacity: 0.78, fillRule: 'evenodd' }} />
      )}
      <GeoJSON data={geometry as never} interactive={false} pathOptions={{ color: CONTORNO, weight: 2.2, fill: false }} />
    </>
  );
}

/** Al entrar o salir de pantalla completa el contenedor cambia de tamaño sin
 * que el navegador dispare "resize": hay que pedirle a Leaflet que recalcule. */
function InvalidarTamano({ pantallaCompleta }: { pantallaCompleta: boolean }) {
  const map = useMap();
  useEffect(() => {
    const id = window.setTimeout(() => map.invalidateSize(), 60);
    return () => window.clearTimeout(id);
  }, [pantallaCompleta, map]);
  return null;
}

const FONDOS: { clave: Fondo; etiqueta: string }[] = [
  { clave: 'claro', etiqueta: 'Claro' },
  { clave: 'calles', etiqueta: 'Calles' },
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
  const [modoColor, setModoColor] = useState<ModoColor>('presencia');
  const [pantallaCompleta, setPantallaCompleta] = useState(false);
  const [resaltada, setResaltada] = useState<number | null>(null);
  const [capa, setCapa] = useState<Capa>('simpatizantes');
  const [categoria, setCategoria] = useState('');
  const [filtros, setFiltros] = useState<FiltrosMapa>({});
  const hayFiltros = Boolean(filtros.miembroId || filtros.desde || filtros.hasta);
  const marcoRef = useRef<HTMLDivElement>(null);
  const capas = useRef(new Map<number, L.Path>());

  const enRaiz = padre === undefined;
  const mapa = useQuery({ queryKey: ['territorio', padre, filtros], queryFn: () => api.mapa(padre, filtros) });
  const miembrosFiltro = useQuery({ queryKey: ['mapa', 'miembros'], queryFn: api.mapaMiembros });
  const contorno = useQuery({ queryKey: ['contorno'], queryFn: api.contorno });
  // Geometría de los municipios: en la raíz comparte caché con `mapa`. Sirve
  // para aislar la vista de un municipio (máscara y encuadre) aunque sus
  // subdivisiones no lo cubran completo.
  const municipiosGeo = useQuery({ queryKey: ['territorio', undefined, {}], queryFn: () => api.mapa() });
  // Catálogo público con el código DANE de cada municipio, para el color fijo por municipio.
  const municipiosCatalogo = useQuery({ queryKey: ['territorio', 'municipios-catalogo'], queryFn: api.municipios });
  const codigoPorMunicipioId = useMemo(
    () => new Map((municipiosCatalogo.data ?? []).map((m) => [m.id, m.codigo_oficial])),
    [municipiosCatalogo.data],
  );

  const features = useMemo(() => mapa.data?.features ?? [], [mapa.data]);
  const conPoligono = useMemo(() => ({ ...mapa.data, features: features.filter((f) => f.geometry) }), [mapa.data, features]);
  // Puestos de votación: del municipio en el que se está, o del municipio
  // seleccionado en la vista del departamento (si no tiene subdivisiones).
  const municipioId = !enRaiz ? crumbs[1]?.id : selected?.properties.tipo === 'MUNICIPIO' ? selected.id : undefined;
  const puestos = useQuery({ queryKey: ['puestos', municipioId], queryFn: () => api.puestos(municipioId!), enabled: puestosVisibles && municipioId !== undefined });
  const simpatizantes = useQuery({
    queryKey: ['simpatizantes', selected?.id, paginaSimpatizantes],
    queryFn: () => api.simpatizantes(selected!.id, paginaSimpatizantes),
    enabled: puedeVerSimpatizantes && mostrarSimpatizantes && selected !== null,
  });

  // El municipio dentro del cual se navega (aunque se esté más abajo).
  const municipioActualId = crumbs[1]?.id;
  const necesidades = useQuery({
    queryKey: ['mapa', 'necesidades', padre, categoria],
    queryFn: () => api.mapaNecesidades(padre, categoria || undefined),
    enabled: capa === 'necesidades',
  });
  const calor = useQuery({
    queryKey: ['mapa', 'calor', municipioActualId, filtros],
    queryFn: () => api.mapaCalor(municipioActualId, filtros),
    enabled: capa === 'calor',
  });
  const brecha = useQuery({
    queryKey: ['mapa', 'brecha', municipioActualId, filtros],
    queryFn: () => api.mapaBrecha(municipioActualId, filtros),
    enabled: capa === 'brecha',
  });
  const necesidadPorZona = useMemo(() => new Map((necesidades.data ?? []).map((n) => [n.territorio_id, n])), [necesidades.data]);

  /** Valor que colorea y ordena cada zona según la capa. */
  function valorDeZona(f: GeoJSON.Feature<GeoJSON.Geometry, ZonaProperties>): number {
    if (capa === 'necesidades') return Number(necesidadPorZona.get(Number(f.id))?.total ?? 0);
    return Number(f.properties.simpatizantes ?? 0);
  }

  const featuresVisibles = features.filter((f) => !f.properties.sinAcceso);
  const max = Math.max(...featuresVisibles.filter((f) => f.geometry).map(valorDeZona), 0);
  const step = max / 5 || 1;
  const totalSinAcceso = mapa.data?.totalSinAcceso ?? false;
  const sumaZonas = featuresVisibles.reduce((s, f) => s + Number(f.properties.simpatizantes ?? 0), 0);
  const total = totalSinAcceso ? null : (mapa.data?.totalSimpatizantes ?? sumaZonas);
  // Registrados directamente en el territorio actual, sin vereda ni comuna.
  const sinZona = total === null ? 0 : Math.max(0, total - sumaZonas);
  const maxFila = Math.max(1, ...featuresVisibles.map(valorDeZona));
  const ordered = [...features].sort((a, b) => {
    const r = sort === 'nombre' ? a.properties.nombre.localeCompare(b.properties.nombre, 'es') : valorDeZona(a) - valorDeZona(b);
    return asc ? r : -r;
  });
  const municipioActual = ((municipiosGeo.data?.features ?? []) as ZonaFeature[]).find((f) => f.id === municipioActualId);
  const modoMunicipios = enRaiz && capa === 'simpatizantes' && modoColor === 'municipios';

  const limites = useMemo(() => {
    if (!enRaiz && municipioActual?.geometry) return new L.GeoJSON(municipioActual.geometry as never).getBounds();
    if (contorno.data) {
      const [minLon, minLat, maxLon, maxLat] = contorno.data.bbox;
      return L.latLngBounds([minLat, minLon], [maxLat, maxLon]);
    }
    return L.latLngBounds([]);
  }, [enRaiz, municipioActual, contorno.data]);

  useEffect(() => {
    const onChange = () => setPantallaCompleta(document.fullscreenElement === marcoRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // Resaltado sincronizado entre la lista y el mapa
  useEffect(() => {
    capas.current.forEach((capa, id) => {
      if (id === resaltada) {
        capa.setStyle({ color: RESALTE, weight: 2.8 });
        capa.bringToFront();
      } else {
        capa.setStyle({ color: '#ffffff', weight: enRaiz ? 1.3 : 0.9 });
      }
    });
  }, [resaltada, modoMunicipios, enRaiz]);

  function alternarPantallaCompleta() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void marcoRef.current?.requestFullscreen();
  }

  function enter(feature: ZonaFeature) {
    if (feature.properties.sinAcceso) return;
    setSelected(feature);
    setMostrarSimpatizantes(false);
    setPaginaSimpatizantes(1);
    if ((feature.properties.subdivisiones ?? 0) > 0 && feature.geometry) {
      setResaltada(null);
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
    setResaltada(null);
    setPuestosVisibles(false);
  }

  /** En la raíz con modo "Municipios": color propio y fijo por municipio.
   * En cualquier otro caso: intensidad de presencia (una sola tonalidad). */
  function colorDeFeature(feature: ZonaFeature) {
    if (feature.properties.sinAcceso) return COLOR_SIN_ACCESO;
    if (capa === 'calor' || capa === 'brecha') return FONDO_NEUTRO;
    if (capa === 'necesidades') return ESCALA_NECESIDADES[nivelDeValor(valorDeZona(feature), step)];
    if (modoMunicipios) return colorMunicipio(codigoPorMunicipioId.get(feature.id));
    return ESCALA_PRESENCIA[nivelDeValor(valorDeZona(feature), step)];
  }

  function style(feature?: GeoJSON.Feature<GeoJSON.Geometry, ZonaProperties>) {
    return {
      fillColor: feature ? colorDeFeature(feature as ZonaFeature) : ESCALA_PRESENCIA[0],
      color: '#ffffff',
      weight: enRaiz ? 1.3 : 0.9,
      fillOpacity: capa === 'calor' || capa === 'brecha' ? 0.45 : 0.88,
    };
  }

  function each(feature: ZonaFeature, layer: Layer) {
    capas.current.set(feature.id, layer as L.Path);
    const sinAcceso = feature.properties.sinAcceso;
    const nombre = nombrePropio(feature.properties.nombre);
    const texto = capa === 'necesidades' && !sinAcceso ? textoNecesidades(necesidadPorZona.get(feature.id)?.por_categoria) : conSimpatizantesOSinAcceso(feature.properties.simpatizantes, sinAcceso);
    const pista = !sinAcceso && (feature.properties.subdivisiones ?? 0) > 0 ? '<br><span style="opacity:.75">Clic para ver sus zonas</span>' : '';
    if (enRaiz) {
      layer.bindTooltip(nombre, { permanent: true, direction: 'center', className: 'municipio-label' });
      layer.on({
        mouseover: (e: LeafletEvent) => {
          if (sinAcceso) return;
          setResaltada(feature.id);
          e.target.setTooltipContent(`<strong>${nombre}</strong><br />${texto}${pista}`);
        },
        mouseout: (e: LeafletEvent) => {
          setResaltada(null);
          e.target.setTooltipContent(nombre);
        },
        click: () => enter(feature),
      });
    } else {
      layer.bindTooltip(`<strong>${nombre}</strong><br />${TIPOS[feature.properties.tipo] ?? ''} · ${texto}${pista}`, { sticky: true, direction: 'top', offset: [0, -8] });
      layer.on({
        mouseover: () => !sinAcceso && setResaltada(feature.id),
        mouseout: () => setResaltada(null),
        click: () => enter(feature),
      });
    }
  }

  const tileUrl = fondo === 'calles' ? TILE_URL_CALLES : TILE_URL_CLARO;
  const atribucion = fondo === 'calles' ? ATRIBUCION_OSM : ATRIBUCION_CARTO;
  const actual = crumbs[crumbs.length - 1];
  const sinPoligono = features.filter((f) => !f.geometry).length;

  return (
    <main className="page-content mapa-page">
      <div className="page-heading">
        <div>
          <nav className="breadcrumbs" aria-label="Ruta territorial">
            {crumbs.map((c, i) => (
              <span key={`${c.nombre}-${i}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {i > 0 && (
                  <span className="crumb-separator">
                    <Icono nombre="flechaDer" tamano={13} />
                  </span>
                )}
                <button type="button" disabled={i === crumbs.length - 1} onClick={() => go(i)}>
                  {nombrePropio(c.nombre)}
                </button>
              </span>
            ))}
          </nav>
          <h1>Mapa territorial</h1>
          <p className="dashboard-subtitle">
            {enRaiz
              ? 'Simpatizantes por municipio. Haz clic en un municipio para ver sus veredas, comunas y corregimientos.'
              : `Simpatizantes por zona en ${nombrePropio(actual.nombre)}.`}
            {hayFiltros && capa !== 'necesidades' && <strong className="filtro-activo"> Con filtros aplicados.</strong>}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="permission-note">
            <Icono nombre="escudo" tamano={14} /> Datos según tu territorio
          </span>
          {crumbs.length > 1 && (
            <button type="button" className="secondary-button" onClick={() => go(crumbs.length - 2)}>
              <Icono nombre="flechaIzq" tamano={16} /> Volver a {nombrePropio(crumbs[crumbs.length - 2].nombre)}
            </button>
          )}
        </div>
      </div>

      <FiltrosBarra miembros={miembrosFiltro.data ?? []} filtros={filtros} onCambio={setFiltros} capa={capa} />

      {(mapa.isPending || contorno.isPending) && <Cargando texto="Cargando cartografía…" />}
      {mapa.isError && <ErrorEstado mensaje={mapa.error.message} reintentar={() => void mapa.refetch()} />}
      {mapa.data && contorno.data && (
        <section className="map-workspace">
          <div className="map-frame" ref={marcoRef}>
            <MapContainer center={[1.1, -74.3]} zoom={7} zoomSnap={0.25} zoomDelta={0.5} scrollWheelZoom maxBoundsViscosity={1} zoomControl={false} className="territory-map" aria-label="Mapa territorial interactivo">
              {fondo !== 'sinfondo' && <TileLayer key={fondo} attribution={atribucion} url={tileUrl} />}
              <InvalidarTamano pantallaCompleta={pantallaCompleta} />
              {enRaiz ? <Mascara geometry={contorno.data.geojson} /> : municipioActual?.geometry && <Mascara geometry={municipioActual.geometry} />}
              <Encuadre limites={limites} clave={`${enRaiz ? 'raiz' : municipioActualId}-${limites.isValid()}`} />
              <GeoJSON
                key={`${padre ?? 'root'}-${max}-${modoColor}-${capa}-${categoria}-${necesidades.dataUpdatedAt}-${mapa.dataUpdatedAt}-${codigoPorMunicipioId.size}`}
                data={conPoligono as never}
                style={style}
                onEachFeature={each as never}
                eventHandlers={{ remove: () => capas.current.clear() }}
              />
              {capa === 'calor' && calor.data && <CapaCalor puntos={calor.data} />}
              {capa === 'brecha' &&
                brecha.data?.map(
                  (p) =>
                    p.lat !== null &&
                    p.lon !== null && (
                      <CircleMarker
                        key={p.puesto_id}
                        center={[p.lat, p.lon]}
                        radius={p.potencial_electoral ? Math.max(5, Math.min(18, 4 + Math.sqrt(p.potencial_electoral) / 6)) : 6}
                        pathOptions={{ color: '#ffffff', weight: 1.5, fillColor: colorCobertura(p), fillOpacity: 0.95 }}
                      >
                        <Popup>
                          <strong>{nombrePropio(p.puesto)}</strong>
                          <br />
                          {nombrePropio(p.municipio)} · {conSimpatizantes(p.simpatizantes)}
                          <br />
                          {p.potencial_electoral
                            ? `Potencial: ${formatNumber(p.potencial_electoral)} · cobertura ${Number(p.cobertura_pct ?? 0).toLocaleString('es-CO')} % · faltan ${formatNumber(Math.max(0, p.potencial_electoral - p.simpatizantes))}`
                            : 'Sin potencial electoral cargado'}
                        </Popup>
                      </CircleMarker>
                    ),
                )}
              {puestosVisibles &&
                capa !== 'brecha' &&
                puestos.data?.map(
                  (p) =>
                    p.lat !== null &&
                    p.lon !== null && (
                      <CircleMarker
                        key={p.id}
                        center={[p.lat, p.lon]}
                        radius={Math.max(5, Math.min(16, 5 + Number(p.simpatizantes ?? 0) / 20))}
                        pathOptions={{ color: '#ffffff', weight: 2, fillColor: CONTORNO, fillOpacity: 1 }}
                      >
                        <Popup>
                          <strong>{nombrePropio(p.nombre)}</strong>
                          <br />
                          Puesto de votación · {conSimpatizantes(Number(p.simpatizantes ?? 0))}
                          {p.potencial_electoral ? (
                            <>
                              <br />
                              Cobertura: {p.cobertura_pct ?? 0} %
                            </>
                          ) : null}
                        </Popup>
                      </CircleMarker>
                    ),
                )}
              <ControlesZoom />
            </MapContainer>
            <div className="map-controls top-right">
              <button type="button" className="map-control-button" onClick={() => go(0)} title="Ver todo el Caquetá" aria-label="Ver todo el Caquetá">
                <Icono nombre="casa" tamano={17} />
              </button>
              <button
                type="button"
                className="map-control-button"
                onClick={alternarPantallaCompleta}
                title={pantallaCompleta ? 'Salir de pantalla completa' : 'Pantalla completa'}
                aria-label={pantallaCompleta ? 'Salir de pantalla completa' : 'Pantalla completa'}
              >
                <Icono nombre={pantallaCompleta ? 'salirPantalla' : 'pantalla'} tamano={17} />
              </button>
            </div>
            <div className="basemap-selector bottom-left" role="group" aria-label="Mapa base">
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
                <p className="eyebrow">{enRaiz ? 'Departamento' : 'Zonas'}</p>
                <h2>{nombrePropio(actual.nombre)}</h2>
                <small style={{ color: 'var(--texto-3)', fontSize: 12.5 }}>
                  {features.length} {enRaiz ? 'municipios' : 'zonas'}
                  {sinPoligono > 0 && ` · ${sinPoligono} sin límite en el mapa`}
                </small>
              </div>
              <div className="total-badge-wrap">
                {total === null ? (
                  <strong className="total-badge total-badge-sin-acceso">{TEXTO_SIN_ACCESO}</strong>
                ) : (
                  <>
                    <strong className="total-badge">{formatNumber(total)}</strong>
                    <small>{palabraSimpatizantes(total)}</small>
                  </>
                )}
              </div>
            </div>
            <div className="capa-selector" role="group" aria-label="Capa del mapa">
              {CAPAS.map((c) => (
                <button key={c.clave} type="button" className={capa === c.clave ? 'selected' : ''} aria-pressed={capa === c.clave} onClick={() => setCapa(c.clave)}>
                  {c.etiqueta}
                </button>
              ))}
            </div>
            {capa === 'necesidades' && (
              <label className="capa-categoria">
                Categoría
                <select value={categoria} onChange={(e) => setCategoria(e.target.value)}>
                  <option value="">Todas</option>
                  {Object.entries(CATEGORIAS_NECESIDAD).map(([codigo, nombre]) => (
                    <option key={codigo} value={codigo}>
                      {nombre}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {enRaiz && capa === 'simpatizantes' && (
              <div className="mode-selector" role="group" aria-label="Color del mapa">
                <button type="button" className={modoColor === 'presencia' ? 'selected' : ''} onClick={() => setModoColor('presencia')}>
                  Presencia
                </button>
                <button type="button" className={modoColor === 'municipios' ? 'selected' : ''} onClick={() => setModoColor('municipios')}>
                  Municipios
                </button>
              </div>
            )}
            {capa === 'brecha' && <BrechaPanel query={brecha} />}
            {municipioId !== undefined && capa !== 'brecha' && (
              <label className="toggle-row">
                <span>
                  <strong>Puestos de votación</strong>
                  <small>Ubicación y simpatizantes que votan en cada uno</small>
                </span>
                <input type="checkbox" checked={puestosVisibles} onChange={(e) => setPuestosVisibles(e.target.checked)} />
              </label>
            )}
            {capa !== 'brecha' && (
            <div className="table-wrap">
              <table>
                <caption className="sr-only">Zonas territoriales y simpatizantes</caption>
                <thead>
                  <tr>
                    <th aria-sort={sort === 'nombre' ? (asc ? 'ascending' : 'descending') : 'none'}>
                      <button
                        type="button"
                        onClick={() => {
                          setSort('nombre');
                          setAsc(sort === 'nombre' ? !asc : true);
                        }}
                      >
                        Zona <Icono nombre={sort === 'nombre' ? (asc ? 'subir' : 'flechaAbajo') : 'ordenar'} tamano={13} />
                      </button>
                    </th>
                    <th aria-sort={sort === 'simpatizantes' ? (asc ? 'ascending' : 'descending') : 'none'}>
                      <button
                        type="button"
                        onClick={() => {
                          setSort('simpatizantes');
                          setAsc(sort === 'simpatizantes' ? !asc : false);
                        }}
                      >
                        {capa === 'necesidades' ? 'Necesidades' : 'Simpatizantes'} <Icono nombre={sort === 'simpatizantes' ? (asc ? 'subir' : 'flechaAbajo') : 'ordenar'} tamano={13} />
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sinZona > 0 && capa !== 'necesidades' && (
                    <tr className="no-map-row">
                      <td>
                        Sin zona asignada
                        <small>Registrados solo con el municipio</small>
                      </td>
                      <td>
                        <strong>{formatNumber(sinZona)}</strong>
                      </td>
                    </tr>
                  )}
                  {ordered.map((f) => {
                    const p = f.properties;
                    const navegable = !p.sinAcceso && (p.subdivisiones ?? 0) > 0 && f.geometry;
                    return (
                      <tr
                        key={f.id}
                        className={`${p.sinAcceso ? 'row-sin-acceso' : ''} ${resaltada === f.id ? 'resaltada' : ''}`}
                        tabIndex={p.sinAcceso ? -1 : 0}
                        onClick={() => enter(f)}
                        onKeyDown={(e) => e.key === 'Enter' && enter(f)}
                        onMouseEnter={() => f.geometry && !p.sinAcceso && setResaltada(f.id)}
                        onMouseLeave={() => setResaltada(null)}
                      >
                        <td>
                          <span className="zona-celda">
                            <i className="zone-swatch" style={{ backgroundColor: f.geometry ? colorDeFeature(f) : 'transparent', borderStyle: f.geometry ? undefined : 'dashed' }} />
                            <span>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                {nombrePropio(p.nombre)}
                                {navegable && <Icono nombre="flechaDer" tamano={13} />}
                              </span>
                              <small>
                                {TIPOS[p.tipo] ?? p.tipo}
                                {!f.geometry && ' · sin límite en el mapa'}
                              </small>
                            </span>
                          </span>
                        </td>
                        <td>
                          {p.sinAcceso ? (
                            TEXTO_SIN_ACCESO
                          ) : (
                            <span className="barra-celda">
                              <i className={capa === 'necesidades' ? 'barra-necesidades' : undefined} style={{ width: `${(valorDeZona(f) / maxFila) * 56}px` }} />
                              <strong style={{ minWidth: 28 }}>{formatNumber(valorDeZona(f))}</strong>
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            )}

            {capa === 'calor' ? (
              <div className="legend">
                <span>Concentración de registros</span>
                <div className="legend-swatches">
                  {LEYENDA_CALOR.map((c) => (
                    <i key={c} style={{ backgroundColor: c }} />
                  ))}
                </div>
                <small>
                  <span>Pocos</span>
                  <span>Muchos</span>
                </small>
                <small className="helper">Sin GPS, cada registro cuenta en su vereda o barrio.</small>
              </div>
            ) : capa === 'necesidades' ? (
              <div className="legend">
                <span>Necesidades reportadas{categoria ? ` · ${CATEGORIAS_NECESIDAD[categoria]}` : ''}</span>
                <div className="legend-swatches">
                  {ESCALA_NECESIDADES.map((c) => (
                    <i key={c} style={{ backgroundColor: c }} />
                  ))}
                </div>
                <small>
                  <span>Ninguna</span>
                  <span>{max > 0 ? `${formatNumber(max)} o más` : 'Más'}</span>
                </small>
              </div>
            ) : capa === 'brecha' ? (
              <div className="legend">
                <span>Cobertura del puesto (simpatizantes / potencial)</span>
                <ul className="leyenda-cobertura">
                  <li><i style={{ background: '#d03b3b' }} /> Menos de 5 %</li>
                  <li><i style={{ background: '#f0a43a' }} /> 5 a 15 %</li>
                  <li><i style={{ background: '#3987e5' }} /> 15 a 30 %</li>
                  <li><i style={{ background: '#1c5cab' }} /> 30 % o más</li>
                  <li><i style={{ background: '#7a8699' }} /> Sin potencial cargado</li>
                </ul>
              </div>
            ) : modoMunicipios ? (
              <div className="legend legend-municipios">
                <span>Municipios</span>
                <ul className="legend-municipios-list">
                  {ordered.map((f) => (
                    <li key={f.id}>
                      <i style={{ backgroundColor: colorMunicipio(codigoPorMunicipioId.get(f.id)) }} />
                      {nombrePropio(f.properties.nombre)}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="legend">
                <span>Intensidad de presencia</span>
                <div className="legend-swatches">
                  {ESCALA_PRESENCIA.map((c) => (
                    <i key={c} style={{ backgroundColor: c }} />
                  ))}
                </div>
                <small>
                  <span>Sin registros</span>
                  <span>{max > 0 ? `${formatNumber(max)} o más` : 'Más registros'}</span>
                </small>
              </div>
            )}

            {selected && puedeVerSimpatizantes && (
              <div className="selection-note">
                <strong>{nombrePropio(selected.properties.nombre)}</strong>
                <span>{conSimpatizantes(Number(selected.properties.simpatizantes ?? 0))}</span>
                <div className="form-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      setMostrarSimpatizantes(true);
                      setPaginaSimpatizantes(1);
                    }}
                  >
                    <Icono nombre="personas" tamano={15} /> Ver simpatizantes
                  </button>
                  <a href={`/simpatizantes?territorioId=${selected.id}`}>Abrir en Simpatizantes</a>
                </div>
                {mostrarSimpatizantes && simpatizantes.data && (
                  <div className="people-list">
                    {simpatizantes.data.datos.map((persona) => (
                      <div key={persona.persona_id}>
                        <strong>{nombrePropio(`${persona.nombres ?? ''} ${persona.apellidos ?? ''}`)}</strong>
                        <small>
                          {nombrePropio(persona.territorio_residencia)} · {nombrePropio(persona.referido_por)}
                          {persona.capturado_en ? ` · ${new Date(persona.capturado_en).toLocaleDateString('es-CO')}` : ''}
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

/** Botones de acercar/alejar abajo a la derecha, lejos del selector de fondo. */
function ControlesZoom() {
  const map = useMap();
  useEffect(() => {
    const control = L.control.zoom({ position: 'bottomright', zoomInTitle: 'Acercar', zoomOutTitle: 'Alejar' });
    control.addTo(map);
    return () => {
      control.remove();
    };
  }, [map]);
  return null;
}

function hoyMenos(dias: number) {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const CARGOS_FILTRO: [string, string][] = [
  ['COORDINADOR', 'Coordinadores'],
  ['LIDER', 'Líderes'],
  ['SUBLIDER', 'Sublíderes'],
];

/** Filtros por red (líder o coordinador, con toda su red) y rango de fechas de captura. */
function FiltrosBarra({ miembros, filtros, onCambio, capa }: { miembros: MiembroFiltro[]; filtros: FiltrosMapa; onCambio: (f: FiltrosMapa) => void; capa: Capa }) {
  const cambiar = (c: Partial<FiltrosMapa>) => onCambio({ ...filtros, ...c });
  const rapido = (dias: number | null) => onCambio({ ...filtros, desde: dias === null ? undefined : hoyMenos(dias - 1), hasta: dias === null ? undefined : hoyMenos(0) });
  const activos = Boolean(filtros.miembroId || filtros.desde || filtros.hasta);
  return (
    <section className="filtros-mapa" aria-label="Filtros del mapa">
      <label>
        Red de
        <select value={filtros.miembroId ?? ''} onChange={(e) => cambiar({ miembroId: e.target.value || undefined })}>
          <option value="">Toda la red visible</option>
          {CARGOS_FILTRO.map(([cargo, etiqueta]) => {
            const lista = miembros.filter((m) => m.cargo_codigo === cargo);
            return (
              lista.length > 0 && (
                <optgroup key={cargo} label={etiqueta}>
                  {lista.map((m) => (
                    <option key={m.miembro_id} value={m.miembro_id}>
                      {nombrePropio(m.nombre)}
                      {m.municipio ? ` · ${nombrePropio(m.municipio)}` : ''}
                    </option>
                  ))}
                </optgroup>
              )
            );
          })}
        </select>
      </label>
      <label>
        Desde
        <input type="date" value={filtros.desde ?? ''} max={filtros.hasta} onChange={(e) => cambiar({ desde: e.target.value || undefined })} />
      </label>
      <label>
        Hasta
        <input type="date" value={filtros.hasta ?? ''} min={filtros.desde} onChange={(e) => cambiar({ hasta: e.target.value || undefined })} />
      </label>
      <div className="segmented" role="group" aria-label="Periodo rápido">
        <button type="button" onClick={() => rapido(7)}>7 días</button>
        <button type="button" onClick={() => rapido(30)}>30 días</button>
        <button type="button" onClick={() => rapido(null)}>Todo</button>
      </div>
      {activos && (
        <button type="button" className="link-button" onClick={() => onCambio({})}>
          Quitar filtros
        </button>
      )}
      {capa === 'necesidades' && activos && <small className="helper">Los filtros de red y fechas no aplican a la capa de necesidades.</small>}
    </section>
  );
}

/** Tabla de puestos ordenada por lo que falta para cubrir su potencial. */
function BrechaPanel({ query }: { query: { isPending: boolean; isError: boolean; error: Error | null; data?: BrechaPuesto[] } }) {
  if (query.isPending) return <Cargando texto="Calculando brecha…" />;
  if (query.isError) return <ErrorEstado mensaje={query.error?.message ?? 'No fue posible calcular la brecha.'} />;
  const puestos = query.data ?? [];
  const conPotencial = puestos.filter((p) => p.potencial_electoral);
  const ordenados = [...conPotencial].sort((a, b) => b.potencial_electoral! - b.simpatizantes - (a.potencial_electoral! - a.simpatizantes));
  const potencial = conPotencial.reduce((s, p) => s + p.potencial_electoral!, 0);
  const simpatizantes = puestos.reduce((s, p) => s + p.simpatizantes, 0);
  // La cobertura solo se calcula sobre los puestos que tienen potencial cargado.
  const simpatizantesConPotencial = conPotencial.reduce((s, p) => s + p.simpatizantes, 0);
  const sinPotencial = puestos.length - conPotencial.length;
  return (
    <div className="brecha-panel">
      {conPotencial.length === 0 ? (
        <div className="aviso-datos">
          <strong>Falta cargar el potencial electoral</strong>
          <span>
            Los {formatNumber(puestos.length)} puestos ya tienen {conSimpatizantes(simpatizantes)}, pero ninguno tiene su potencial de votantes. Cárguelo con
            el archivo de la Registraduría (ver docs/mapas-datos.md) y aquí aparecerá la brecha de cada puesto.
          </span>
        </div>
      ) : (
        <>
          <p className="brecha-resumen">
            <strong>{potencial ? ((100 * simpatizantesConPotencial) / potencial).toLocaleString('es-CO', { maximumFractionDigits: 1 }) : 0} %</strong> de cobertura:{' '}
            {formatNumber(simpatizantesConPotencial)} simpatizantes de {formatNumber(potencial)} votantes potenciales.
            {sinPotencial > 0 && (
              <small>
                {' '}
                {formatNumber(sinPotencial)} {sinPotencial === 1 ? 'puesto no tiene' : 'puestos no tienen'} potencial cargado (ver docs/mapas-datos.md).
              </small>
            )}
          </p>
          <div className="table-wrap">
            <table>
              <caption className="sr-only">Brecha electoral por puesto</caption>
              <thead>
                <tr>
                  <th>Puesto</th>
                  <th>Cobertura</th>
                  <th>Faltan</th>
                </tr>
              </thead>
              <tbody>
                {ordenados.slice(0, 60).map((p) => (
                  <tr key={p.puesto_id}>
                    <td>
                      {nombrePropio(p.puesto)}
                      <small>
                        {nombrePropio(p.municipio)} · {formatNumber(p.simpatizantes)} de {formatNumber(p.potencial_electoral)}
                      </small>
                    </td>
                    <td>
                      <span className="barra-celda">
                        <i style={{ width: `${Math.min(56, Number(p.cobertura_pct ?? 0) * 0.56)}px`, background: colorCobertura(p) }} />
                        <strong>{Number(p.cobertura_pct ?? 0).toLocaleString('es-CO')} %</strong>
                      </span>
                    </td>
                    <td>
                      <strong>{formatNumber(Math.max(0, p.potencial_electoral! - p.simpatizantes))}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
