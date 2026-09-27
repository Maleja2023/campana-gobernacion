import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import * as L from 'leaflet';
import type { PuntoCalor } from '../api/cliente';

/** Degradado del mapa de calor: de azul (pocos registros) a rojo (muchos). */
const DEGRADADO: [number, string][] = [
  [0.0, 'rgba(57,135,229,0)'],
  [0.25, '#3987e5'],
  [0.5, '#2fb3a0'],
  [0.7, '#f2c14e'],
  [0.85, '#f08a3c'],
  [1.0, '#d03b3b'],
];

function paleta(): Uint8ClampedArray {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 1;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 256, 0);
  for (const [pos, color] of DEGRADADO) g.addColorStop(pos, color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 1);
  return ctx.getImageData(0, 0, 256, 1).data;
}

/**
 * Capa de calor dibujada en un canvas sobre el mapa. Cada punto suma
 * intensidad según su peso; el total se colorea con DEGRADADO. Se redibuja
 * al mover o acercar el mapa, con un radio que crece con el zoom.
 */
class CanvasCalor extends L.Layer {
  private canvas?: HTMLCanvasElement;
  private readonly colores = paleta();
  private readonly puntos: PuntoCalor[];

  constructor(puntos: PuntoCalor[]) {
    super();
    this.puntos = puntos;
  }

  onAdd(map: L.Map): this {
    this.canvas = L.DomUtil.create('canvas', 'capa-calor leaflet-zoom-hide');
    map.getPanes().overlayPane.appendChild(this.canvas);
    map.on('moveend zoomend resize', this.dibujar, this);
    this.dibujar();
    return this;
  }

  onRemove(map: L.Map): this {
    map.off('moveend zoomend resize', this.dibujar, this);
    this.canvas?.remove();
    return this;
  }

  private dibujar() {
    const map = this._map;
    if (!map || !this.canvas) return;
    const tamano = map.getSize();
    const canvas = this.canvas;
    canvas.width = tamano.x;
    canvas.height = tamano.y;
    L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx || !this.puntos.length) return;

    const radio = Math.max(14, Math.min(48, 5 * (map.getZoom() - 4)));
    const maximo = Math.max(...this.puntos.map((p) => p.peso));
    const limites = map.getBounds().pad(0.2);
    for (const p of this.puntos) {
      if (!limites.contains([p.lat, p.lon])) continue;
      const { x, y } = map.latLngToContainerPoint([p.lat, p.lon]);
      // Raíz cuadrada: una vereda con muchos registros no apaga a las demás.
      const intensidad = 0.3 + 0.7 * Math.sqrt(p.peso / maximo);
      const g = ctx.createRadialGradient(x, y, 0, x, y, radio);
      g.addColorStop(0, `rgba(0,0,0,${intensidad})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - radio, y - radio, radio * 2, radio * 2);
    }

    const imagen = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const px = imagen.data;
    for (let i = 3; i < px.length; i += 4) {
      const a = px[i];
      if (!a) continue;
      const j = a * 4;
      px[i - 3] = this.colores[j];
      px[i - 2] = this.colores[j + 1];
      px[i - 1] = this.colores[j + 2];
      px[i] = Math.min(225, a * 2);
    }
    ctx.putImageData(imagen, 0, 0);
  }
}

export function CapaCalor({ puntos }: { puntos: PuntoCalor[] }) {
  const map = useMap();
  useEffect(() => {
    const capa = new CanvasCalor(puntos);
    capa.addTo(map);
    return () => {
      capa.remove();
    };
  }, [map, puntos]);
  return null;
}

export const LEYENDA_CALOR = DEGRADADO.slice(1).map(([, c]) => c);
