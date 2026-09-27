import { useEffect, useRef, useState } from 'react';
import type { RegistroDiario } from '../api/tipos';
import { fmtDia, fmtNumero } from '../util/formato';

const ALTO = 240;
const MARGEN = { arriba: 12, derecha: 8, abajo: 26, izquierda: 36 };

function escalaAgradable(maximo: number): number[] {
  if (maximo <= 0) return [0, 1];
  const paso0 = maximo / 4;
  const potencia = 10 ** Math.floor(Math.log10(paso0));
  const paso = [1, 2, 2.5, 5, 10].map((m) => m * potencia).find((p) => p >= paso0) ?? potencia * 10;
  const tope = Math.ceil(maximo / paso) * paso;
  return Array.from({ length: Math.round(tope / paso) + 1 }, (_, i) => i * paso);
}

/** Registros por día: barras de una sola serie con detalle al pasar el cursor. */
export function GraficoRegistros({ datos }: { datos: RegistroDiario[] }) {
  const contenedor = useRef<HTMLDivElement>(null);
  const [ancho, setAncho] = useState(600);
  const [activo, setActivo] = useState<number | null>(null);

  useEffect(() => {
    const el = contenedor.current;
    if (!el) return;
    const observador = new ResizeObserver(([entrada]) => setAncho(entrada.contentRect.width));
    observador.observe(el);
    return () => observador.disconnect();
  }, []);

  const marcas = escalaAgradable(Math.max(0, ...datos.map((d) => d.registros)));
  const tope = marcas[marcas.length - 1];
  const anchoUtil = Math.max(10, ancho - MARGEN.izquierda - MARGEN.derecha);
  const altoUtil = ALTO - MARGEN.arriba - MARGEN.abajo;
  const banda = anchoUtil / Math.max(1, datos.length);
  const anchoBarra = Math.max(2, Math.min(28, banda - 2));
  const y = (v: number) => MARGEN.arriba + altoUtil - (v / tope) * altoUtil;
  const cadaCuanto = Math.ceil(datos.length / Math.max(1, Math.floor(anchoUtil / 64)));

  const d = activo !== null ? datos[activo] : null;

  return (
    <div className="grafico" ref={contenedor} onMouseLeave={() => setActivo(null)}>
      <svg height={ALTO} role="img" aria-label={`Registros diarios de los últimos ${datos.length} días`}>
        <g className="eje">
          {marcas.map((m) => (
            <g key={m}>
              <line className={m === 0 ? 'linea-base' : 'rejilla-linea'} x1={MARGEN.izquierda} x2={ancho - MARGEN.derecha} y1={y(m)} y2={y(m)} />
              <text x={MARGEN.izquierda - 8} y={y(m) + 4} textAnchor="end">
                {fmtNumero(m)}
              </text>
            </g>
          ))}
          {datos.map((dato, i) =>
            i % cadaCuanto === 0 ? (
              <text key={dato.fecha} x={MARGEN.izquierda + banda * i + banda / 2} y={ALTO - 6} textAnchor="middle">
                {fmtDia(dato.fecha)}
              </text>
            ) : null,
          )}
        </g>
        {datos.map((dato, i) => {
          const x = MARGEN.izquierda + banda * i + (banda - anchoBarra) / 2;
          const alto = Math.max(0, y(0) - y(dato.registros));
          const r = Math.min(4, anchoBarra / 2, alto);
          // Barra con esquinas redondeadas solo arriba, apoyada en la línea base
          const camino = alto <= 0 ? '' : `M${x},${y(0)} V${y(dato.registros) + r} Q${x},${y(dato.registros)} ${x + r},${y(dato.registros)} H${x + anchoBarra - r} Q${x + anchoBarra},${y(dato.registros)} ${x + anchoBarra},${y(dato.registros) + r} V${y(0)} Z`;
          return (
            <g key={dato.fecha}>
              <path className={`barra ${activo === i ? 'activa' : ''}`} d={camino} />
              <rect x={MARGEN.izquierda + banda * i} y={MARGEN.arriba} width={banda} height={altoUtil} fill="transparent" onMouseEnter={() => setActivo(i)}>
                <title>{`${fmtDia(dato.fecha)}: ${dato.registros} registros`}</title>
              </rect>
            </g>
          );
        })}
      </svg>
      {d && activo !== null && (
        <div className="info-flotante" style={{ left: MARGEN.izquierda + banda * activo + banda / 2, top: y(d.registros) }}>
          <strong className="num">{fmtNumero(d.registros)}</strong> registros · {fmtDia(d.fecha)}
        </div>
      )}
    </div>
  );
}
