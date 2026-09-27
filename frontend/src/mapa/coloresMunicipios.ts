/**
 * Color fijo por municipio del Caquetá para el modo de color "Municipios" del mapa.
 *
 * Se indexa por código DANE (`territorio.territorios.codigo_oficial` para
 * tipo MUNICIPIO, expuesto por GET /territorio/municipios). El orden de
 * asignación sigue, de forma aproximada, la posición geográfica real de cada
 * municipio (en sentido horario, partiendo de Florencia) para que dos
 * municipios vecinos no compartan color. Si al revisar el mapa aparece algún
 * par de vecinos con el mismo tono, ajusta el color de uno de los dos aquí
 * mismo — es la única fuente de verdad para estos colores en toda la app.
 */

const PALETA: readonly string[] = [
  '#f6d565', // amarillo pastel
  '#f2a35d', // naranja pastel
  '#a7d6a0', // verde suave
  '#c6aee0', // lila
  '#f2b3c1', // rosado
  '#a3cfe6', // azul claro
  '#f0c48a', // durazno
  '#9fd8c9', // verde menta
];

/** Color para un municipio sin código reconocido (no debería ocurrir en producción). */
export const COLOR_MUNICIPIO_RESPALDO = '#d8ded6';

const COLOR_POR_CODIGO_DANE: Record<string, string> = {
  '18001': PALETA[0], // Florencia
  '18479': PALETA[1], // Morelia
  '18094': PALETA[2], // Belén de los Andaquíes
  '18610': PALETA[3], // San José del Fragua
  '18029': PALETA[4], // Albania
  '18785': PALETA[5], // Solita
  '18205': PALETA[6], // Curillo
  '18460': PALETA[7], // Milán
  '18860': PALETA[0], // Valparaíso
  '18247': PALETA[1], // El Doncello
  '18256': PALETA[2], // El Paujil
  '18592': PALETA[3], // Puerto Rico
  '18150': PALETA[4], // Cartagena del Chairá
  '18756': PALETA[5], // Solano
  '18753': PALETA[6], // San Vicente del Caguán
  '18410': PALETA[7], // La Montañita
};

/** Hash estable (no aleatorio) para un código sin entrada explícita: mantiene
 * el mismo color entre recargas, aunque no garantiza evitar coincidencias
 * con un vecino. */
function colorPorHash(codigo: string): string {
  let hash = 0;
  for (let i = 0; i < codigo.length; i++) hash = (hash * 31 + codigo.charCodeAt(i)) >>> 0;
  return PALETA[hash % PALETA.length];
}

export function colorMunicipio(codigoOficial: string | null | undefined): string {
  if (!codigoOficial) return COLOR_MUNICIPIO_RESPALDO;
  return COLOR_POR_CODIGO_DANE[codigoOficial] ?? colorPorHash(codigoOficial);
}

function componentes(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

function aHex(v: number): string {
  return Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
}

/** Mezcla un color hacia blanco (cantidad > 0) o hacia negro (cantidad < 0). */
function mezclar(hex: string, cantidad: number): string {
  const [r, g, b] = componentes(hex);
  const objetivo = cantidad > 0 ? 255 : 0;
  const t = Math.abs(cantidad);
  const mezcla = (c: number) => c + (objetivo - c) * t;
  return `#${aHex(mezcla(r))}${aHex(mezcla(g))}${aHex(mezcla(b))}`;
}

/** Escala de calor (6 tonos, índice = nivel 0..5) tintada con el color de un
 * municipio: para la vista de presencia dentro de un municipio, en vez del
 * verde fijo de siempre. El nivel 0 ("sin registros") se mantiene neutro para
 * que su significado no cambie según el municipio. */
export function escalaTintada(base: string): string[] {
  return ['#e8ece7', mezclar(base, 0.5), mezclar(base, 0.22), mezclar(base, -0.05), mezclar(base, -0.22), mezclar(base, -0.42)];
}
