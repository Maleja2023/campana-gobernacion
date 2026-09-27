const MINUSCULAS = new Set(['de', 'del', 'y', 'e']);
const ARTICULOS = new Set(['la', 'las', 'los', 'el']);

/** "SAN VICENTE DEL CAGUÁN" -> "San Vicente del Caguán" (nombres oficiales vienen en mayúsculas). */
export function nombrePropio(texto: string | null | undefined): string {
  if (!texto) return '';
  const partes = texto.toLocaleLowerCase('es-CO').split(/(\s+|-|\()/);
  return partes
    .map((parte, i) => {
      // "del Caguán", "de los Andaquíes" en minúscula; "El Doncello" con mayúscula
      const minuscula = i > 0 && (MINUSCULAS.has(parte) || (ARTICULOS.has(parte) && partes[i - 2] === 'de'));
      return minuscula ? parte : parte.charAt(0).toLocaleUpperCase('es-CO') + parte.slice(1);
    })
    .join('');
}
