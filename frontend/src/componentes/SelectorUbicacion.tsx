import { useEffect, useState } from 'react';
import { CircleMarker, MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet';

const TILE_URL = import.meta.env.VITE_TILES_URL ?? 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const CENTRO_CAQUETA: [number, number] = [1.614, -75.606];

export type Punto = { lon: number; lat: number };

function AlHacerClic({ onElegir }: { onElegir: (p: Punto) => void }) {
  useMapEvents({ click: (e) => onElegir({ lon: Number(e.latlng.lng.toFixed(6)), lat: Number(e.latlng.lat.toFixed(6)) }) });
  return null;
}

function Centrar({ punto }: { punto?: Punto }) {
  const map = useMap();
  useEffect(() => {
    if (punto) map.setView([punto.lat, punto.lon], Math.max(map.getZoom(), 14));
  }, [punto, map]);
  return null;
}

/** Mapa para marcar dónde será un evento: clic en el mapa o la ubicación del celular. */
export function SelectorUbicacion({ valor, onCambio }: { valor?: Punto; onCambio: (p?: Punto) => void }) {
  const [centrar, setCentrar] = useState<Punto>();
  const [error, setError] = useState('');

  function usarMiUbicacion() {
    setError('');
    if (!navigator.geolocation) return setError('Este dispositivo no permite obtener la ubicación.');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p = { lon: Number(pos.coords.longitude.toFixed(6)), lat: Number(pos.coords.latitude.toFixed(6)) };
        onCambio(p);
        setCentrar(p);
      },
      () => setError('No se pudo obtener la ubicación. Revisa el permiso del navegador o marca el punto en el mapa.'),
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  }

  return (
    <div className="selector-ubicacion">
      <div className="selector-ubicacion-cabecera">
        <span>Lugar del evento {valor ? `(${valor.lat}, ${valor.lon})` : '(opcional: haz clic en el mapa)'}</span>
        <div>
          <button type="button" className="link-button" onClick={usarMiUbicacion}>
            Usar mi ubicación
          </button>
          {valor && (
            <button type="button" className="link-button" onClick={() => onCambio(undefined)}>
              Quitar
            </button>
          )}
        </div>
      </div>
      <MapContainer center={CENTRO_CAQUETA} zoom={8} className="selector-ubicacion-mapa">
        <TileLayer attribution="&copy; OpenStreetMap contributors" url={TILE_URL} />
        <AlHacerClic onElegir={onCambio} />
        <Centrar punto={centrar} />
        {valor && <CircleMarker center={[valor.lat, valor.lon]} radius={9} pathOptions={{ color: '#ffffff', weight: 3, fillColor: '#1c5cab', fillOpacity: 1 }} />}
      </MapContainer>
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}
