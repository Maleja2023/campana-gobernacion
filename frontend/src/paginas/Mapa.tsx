import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/cliente';
import type { ColeccionMapa, Puesto, ZonaMapa } from '../api/tipos';
import { Columna, Encabezado, ErrorCarga, Tarjeta, useOrden, Vacio } from '../componentes/Base';
import { Icono } from '../componentes/Icono';
import { useSesion } from '../sesion/Sesion';
import { fmtNumero, nombrePropio, TIPOS_ZONA } from '../util/formato';
import { useDatos } from '../util/useDatos';

// Escala secuencial de un solo tono (claro = pocos, oscuro = muchos).
const ESCALA = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#0d366b'];
const SIN_REGISTROS = '#eef2f6';

const FONDOS = {
  claro: {
    nombre: 'Claro',
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    atribucion: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
  },
  calles: {
    nombre: 'Calles',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    atribucion: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  },
  satelite: {
    nombre: 'Satélite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    atribucion: 'Imágenes &copy; Esri, Maxar, Earthstar Geographics',
  },
  ninguno: { nombre: 'Sin fondo', url: '', atribucion: '' },
} as const;
type Fondo = keyof typeof FONDOS;

interface Nivel {
  id: number | null;
  nombre: string;
  tipo: string;
  geometria: GeoJSON.Geometry | null;
  simpatizantes: number | null;
}

/** Cortes por cuantiles sobre los valores mayores que cero (máximo 6 clases). */
function calcularCortes(valores: number[]): number[] {
  const positivos = valores.filter((v) => v > 0).sort((a, b) => a - b);
  if (positivos.length === 0) return [];
  const cortes: number[] = [];
  for (let i = 1; i <= ESCALA.length; i++) {
    const v = positivos[Math.min(positivos.length - 1, Math.ceil((i / ESCALA.length) * positivos.length) - 1)];
    if (cortes[cortes.length - 1] !== v) cortes.push(v);
  }
  return cortes;
}

function colorPara(valor: number, cortes: number[]): string {
  if (valor <= 0 || cortes.length === 0) return SIN_REGISTROS;
  const indice = cortes.findIndex((c) => valor <= c);
  const clase = indice === -1 ? cortes.length - 1 : indice;
  // Reparte las clases disponibles sobre toda la escala para usar el contraste completo.
  const paso = cortes.length === 1 ? ESCALA.length - 1 : Math.round((clase * (ESCALA.length - 1)) / (cortes.length - 1));
  return ESCALA[paso];
}

type ClaveOrden = 'nombre' | 'tipo' | 'simpatizantes';

export function Mapa() {
  const { puede } = useSesion();
  const [niveles, setNiveles] = useState<Nivel[]>([{ id: null, nombre: 'Caquetá', tipo: 'DEPARTAMENTO', geometria: null, simpatizantes: null }]);
  const [fondo, setFondo] = useState<Fondo>('claro');
  const [verPuestos, setVerPuestos] = useState(false);
  const [resaltada, setResaltada] = useState<number | null>(null);

  const actual = niveles[niveles.length - 1];
  const zonas = useDatos(() => api.get<ColeccionMapa>('/territorio/mapa', { padre: actual.id ?? undefined }), [actual.id]);
  const municipioId = actual.tipo === 'MUNICIPIO' ? actual.id : null;
  const puestos = useDatos(
    () => (verPuestos && municipioId ? api.get<Puesto[]>('/tablero/puestos', { municipioId }) : Promise.resolve([] as Puesto[])),
    [verPuestos, municipioId],
  );

  const features = zonas.datos?.features ?? [];
  const conPoligono = features.filter((f) => f.geometry);
  const sinPoligono = features.filter((f) => !f.geometry);
  const total = features.reduce((s, f) => s + f.properties.simpatizantes, 0);
  const totalSinPoligono = sinPoligono.reduce((s, f) => s + f.properties.simpatizantes, 0);
  // Registrados directamente en el territorio actual, sin vereda ni comuna
  const sinZona = zonas.datos && actual.simpatizantes !== null ? Math.max(0, actual.simpatizantes - total) : 0;
  const cortes = useMemo(() => calcularCortes(conPoligono.map((f) => f.properties.simpatizantes)), [zonas.datos]); // eslint-disable-line react-hooks/exhaustive-deps
  const maximo = Math.max(1, ...features.map((f) => f.properties.simpatizantes));

  const { ordenadas, orden, alternar } = useOrden<ZonaMapa, ClaveOrden>(
    features,
    (f, clave) => (clave === 'nombre' ? f.properties.nombre : clave === 'tipo' ? f.properties.tipo : f.properties.simpatizantes),
    { clave: 'simpatizantes', dir: 'desc' },
  );

  // ---------- Leaflet ----------
  const lienzo = useRef<HTMLDivElement>(null);
  const mapa = useRef<L.Map | null>(null);
  const capaFondo = useRef<L.TileLayer | null>(null);
  const capaZonas = useRef<L.GeoJSON | null>(null);
  const capaContorno = useRef<L.GeoJSON | null>(null);
  const capaPuestos = useRef<L.LayerGroup | null>(null);
  const porId = useRef(new Map<number, L.Path>());

  useEffect(() => {
    if (!lienzo.current || mapa.current) return;
    const m = L.map(lienzo.current, { zoomControl: false, attributionControl: true, minZoom: 6, maxZoom: 17, zoomSnap: 0.25 });
    L.control.zoom({ position: 'bottomright', zoomInTitle: 'Acercar', zoomOutTitle: 'Alejar' }).addTo(m);
    m.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
    m.setView([1.1, -74.3], 7);
    mapa.current = m;
    return () => {
      m.remove();
      mapa.current = null;
    };
  }, []);

  useEffect(() => {
    const m = mapa.current;
    if (!m) return;
    capaFondo.current?.remove();
    capaFondo.current = null;
    const f = FONDOS[fondo];
    if (f.url) capaFondo.current = L.tileLayer(f.url, { attribution: f.atribucion, subdomains: 'abcd', maxZoom: 19 }).addTo(m);
  }, [fondo]);

  // Solo usa setters de estado: la misma función sirve para todas las capas.
  const entrar = useCallback((f: ZonaMapa) => {
    if (f.properties.subdivisiones > 0 && f.geometry) {
      setResaltada(null);
      setNiveles((n) => [...n, { id: f.id, nombre: f.properties.nombre, tipo: f.properties.tipo, geometria: f.geometry, simpatizantes: f.properties.simpatizantes }]);
    }
  }, []);

  useEffect(() => {
    const m = mapa.current;
    if (!m || !zonas.datos) return;
    capaZonas.current?.remove();
    capaContorno.current?.remove();
    porId.current.clear();

    // Contorno del territorio padre: muestra también las partes sin subdivisión
    if (actual.geometria) {
      capaContorno.current = L.geoJSON(actual.geometria as GeoJSON.GeoJsonObject, {
        style: { color: '#0b1b2e', weight: 2.2, fill: true, fillColor: '#ffffff', fillOpacity: 0.35, dashArray: undefined },
        interactive: false,
      }).addTo(m);
    }

    const capa = L.geoJSON(
      { type: 'FeatureCollection', features: conPoligono } as GeoJSON.FeatureCollection,
      {
        style: (f) => ({
          color: '#ffffff',
          weight: actual.id === null ? 1.4 : 0.9,
          fillColor: colorPara((f?.properties as ZonaMapa['properties'] | undefined)?.simpatizantes ?? 0, cortes),
          fillOpacity: 0.86,
        }),
        onEachFeature: (f, capaZona) => {
          const zona = f as unknown as ZonaMapa;
          porId.current.set(zona.id, capaZona as L.Path);
          const p = zona.properties;
          capaZona.bindTooltip(
            `<strong>${nombrePropio(p.nombre)}</strong>${TIPOS_ZONA[p.tipo] ?? p.tipo} · ${fmtNumero(p.simpatizantes)} simpatizantes${p.subdivisiones > 0 ? '<br><span style="opacity:.75">Clic para ver subdivisiones</span>' : ''}`,
            { sticky: true, className: 'etiqueta-mapa', direction: 'top', offset: [0, -8] },
          );
          capaZona.on({
            mouseover: () => setResaltada(zona.id),
            mouseout: () => setResaltada(null),
            click: () => entrar(zona),
          });
        },
      },
    ).addTo(m);
    capaZonas.current = capa;

    const limites = capaContorno.current?.getBounds() ?? capa.getBounds();
    if (limites.isValid()) m.flyToBounds(limites, { paddingTopLeft: [24, 64], paddingBottomRight: [24, 24], duration: 0.6 });
  }, [zonas.datos]); // eslint-disable-line react-hooks/exhaustive-deps

  // Resaltado sincronizado entre mapa y tabla
  useEffect(() => {
    porId.current.forEach((capa, id) => {
      if (id === resaltada) {
        capa.setStyle({ color: '#0b1b2e', weight: 2.6 });
        capa.bringToFront();
      } else {
        capa.setStyle({ color: '#ffffff', weight: actual.id === null ? 1.4 : 0.9 });
      }
    });
  }, [resaltada, actual.id]);

  useEffect(() => {
    const m = mapa.current;
    capaPuestos.current?.remove();
    capaPuestos.current = null;
    if (!m || !verPuestos || !puestos.datos?.length) return;
    const grupo = L.layerGroup();
    for (const p of puestos.datos) {
      L.circleMarker([p.lat, p.lon], { radius: 6, color: '#ffffff', weight: 2, fillColor: '#0b1b2e', fillOpacity: 1 })
        .bindTooltip(`<strong>${nombrePropio(p.puesto)}</strong>Puesto de votación · ${fmtNumero(p.simpatizantes)} simpatizantes votan aquí`, { className: 'etiqueta-mapa', direction: 'top', offset: [0, -6] })
        .addTo(grupo);
    }
    capaPuestos.current = grupo.addTo(m);
  }, [puestos.datos, verPuestos]);

  const irANivel = (indice: number) => {
    setResaltada(null);
    setNiveles((n) => n.slice(0, indice + 1));
  };

  return (
    <>
      <Encabezado
        titulo="Mapa territorial"
        migas={
          <nav className="migas" aria-label="Ubicación">
            {niveles.map((n, i) => (
              <span key={n.id ?? 'raiz'} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                {i > 0 && <Icono nombre="flechaDer" tamano={13} />}
                {i < niveles.length - 1 ? <button onClick={() => irANivel(i)}>{nombrePropio(n.nombre)}</button> : <span>{nombrePropio(n.nombre)}</span>}
              </span>
            ))}
          </nav>
        }
        descripcion={
          actual.id === null
            ? 'Simpatizantes por municipio. Haga clic en un municipio para ver sus veredas, comunas y corregimientos.'
            : `Simpatizantes por zona en ${nombrePropio(actual.nombre)}.`
        }
        acciones={
          niveles.length > 1 && (
            <button className="boton" onClick={() => irANivel(niveles.length - 2)}>
              <Icono nombre="flechaIzq" tamano={16} /> Volver a {nombrePropio(niveles[niveles.length - 2].nombre)}
            </button>
          )
        }
      />

      <div className="mapa-disposicion">
        <div className="tarjeta mapa-marco">
          <div ref={lienzo} className="mapa-lienzo" aria-label={`Mapa de ${actual.nombre}`} />
          {zonas.cargando && <div className="mapa-cargando">Cargando cartografía…</div>}
          <div className="mapa-controles">
            <div className="segmentado" role="group" aria-label="Mapa base">
              {(Object.keys(FONDOS) as Fondo[]).map((f) => (
                <button key={f} aria-pressed={fondo === f} onClick={() => setFondo(f)}>
                  {FONDOS[f].nombre}
                </button>
              ))}
            </div>
            {municipioId && puede('MAPA_VER') && (
              <button className="boton boton-chico" aria-pressed={verPuestos} onClick={() => setVerPuestos((v) => !v)} style={verPuestos ? { borderColor: 'var(--acento)', color: 'var(--acento-texto)' } : undefined}>
                <Icono nombre="pin" tamano={15} /> Puestos de votación
              </button>
            )}
          </div>
          <div className="mapa-leyenda">
            <strong>Simpatizantes por zona</strong>
            <div className="leyenda-escala">
              <span style={{ background: SIN_REGISTROS, outline: '1px solid var(--borde)' }} title="Sin registros" />
              {ESCALA.map((c) => (
                <span key={c} style={{ background: c }} />
              ))}
            </div>
            <div className="leyenda-limites">
              <span>0</span>
              <span>{fmtNumero(cortes[cortes.length - 1] ?? 0)}</span>
            </div>
            {actual.geometria && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                <span style={{ width: 18, height: 0, borderTop: '2px solid #0b1b2e' }} /> Límite de {nombrePropio(actual.nombre)}
              </div>
            )}
          </div>
        </div>

        <Tarjeta className="panel-zonas" sinRelleno>
          <div className="panel-resumen" style={{ marginTop: -12 }}>
            <div>
              <span>{actual.id === null ? 'Municipios' : 'Zonas'}</span>
              <strong className="num">{fmtNumero(features.length)}</strong>
            </div>
            <div>
              <span>Simpatizantes</span>
              <strong className="num">{fmtNumero(total + sinZona)}</strong>
            </div>
          </div>
          {sinPoligono.length > 0 && (
            <div style={{ padding: '12px 20px 0' }}>
              <div className="aviso aviso-info" style={{ fontSize: 13 }}>
                <Icono nombre="info" tamano={16} />
                <span>
                  {sinPoligono.length} {sinPoligono.length === 1 ? 'zona no tiene' : 'zonas no tienen'} límite oficial publicado ({fmtNumero(totalSinPoligono)} simpatizantes). Aparecen en la lista pero no en el mapa.
                </span>
              </div>
            </div>
          )}
          {zonas.error ? (
            <div style={{ paddingTop: 12 }}><ErrorCarga mensaje={zonas.error} reintentar={zonas.recargar} /></div>
          ) : features.length === 0 && !zonas.cargando ? (
            <Vacio titulo="Este territorio no tiene subdivisiones cargadas" />
          ) : (
            <div className="tabla-envoltura" style={{ marginTop: 8 }}>
              <table className="tabla">
                <thead>
                  <tr>
                    <Columna clave="nombre" orden={orden} alternar={alternar}>Zona</Columna>
                    <Columna clave="simpatizantes" orden={orden} alternar={alternar} derecha>Simpatizantes</Columna>
                  </tr>
                </thead>
                <tbody>
                  {sinZona > 0 && (
                    <tr>
                      <td>
                        Sin zona asignada
                        <span className="secundario">Registrados solo con el municipio</span>
                      </td>
                      <td className="derecha">
                        <span className="barra-celda">
                          <i style={{ width: `${(sinZona / maximo) * 64}px`, background: 'var(--borde-fuerte)' }} />
                          <strong className="num" style={{ minWidth: 32 }}>{fmtNumero(sinZona)}</strong>
                        </span>
                      </td>
                    </tr>
                  )}
                  {ordenadas.map((f) => {
                    const p = f.properties;
                    const navegable = p.subdivisiones > 0 && f.geometry;
                    return (
                      <tr
                        key={f.id}
                        className={`${resaltada === f.id ? 'resaltada' : ''} ${navegable ? 'fila-accion' : ''}`}
                        onMouseEnter={() => f.geometry && setResaltada(f.id)}
                        onMouseLeave={() => setResaltada(null)}
                        onClick={() => navegable && entrar(f)}
                      >
                        <td>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            {nombrePropio(p.nombre)}
                            {navegable && <Icono nombre="flechaDer" tamano={13} className="texto-3" />}
                          </span>
                          <span className="secundario">
                            {TIPOS_ZONA[p.tipo] ?? p.tipo}
                            {!f.geometry && ' · sin límite en el mapa'}
                          </span>
                        </td>
                        <td className="derecha">
                          <span className="barra-celda">
                            <i style={{ width: `${(p.simpatizantes / maximo) * 64}px` }} />
                            <strong className="num" style={{ minWidth: 32 }}>{fmtNumero(p.simpatizantes)}</strong>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Tarjeta>
      </div>
    </>
  );
}
