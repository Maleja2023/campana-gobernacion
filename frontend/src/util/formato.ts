const numero = new Intl.NumberFormat('es-CO');
const fechaCorta = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const fechaLarga = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });
const fechaHora = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

export const fmtNumero = (n: number | null | undefined) => (n === null || n === undefined ? '—' : numero.format(n));
export const fmtPorcentaje = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : `${n.toLocaleString('es-CO', { maximumFractionDigits: 1 })} %`;
/** Fechas que la API entrega a medianoche UTC (días calendario). */
export const fmtDia = (iso: string) => fechaCorta.format(new Date(iso));
export const fmtFecha = (iso: string | null) => (iso ? fechaLarga.format(new Date(iso)) : '—');
export const fmtFechaHora = (iso: string | null) => (iso ? fechaHora.format(new Date(iso)) : '—');

/** "hace 3 días", "hace 2 h" */
export function fmtHace(iso: string | null): string {
  if (!iso) return 'Sin registros';
  const minutos = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutos < 60) return `hace ${Math.max(1, minutos)} min`;
  const horas = Math.round(minutos / 60);
  if (horas < 24) return `hace ${horas} h`;
  const dias = Math.round(horas / 24);
  return `hace ${dias} ${dias === 1 ? 'día' : 'días'}`;
}

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

export const CARGOS: Record<string, string> = {
  GERENTE: 'Gerente',
  COORDINADOR: 'Coordinador',
  LIDER: 'Líder',
  SUBLIDER: 'Sublíder',
};

export const TIPOS_ZONA: Record<string, string> = {
  DEPARTAMENTO: 'Departamento',
  MUNICIPIO: 'Municipio',
  COMUNA: 'Comuna',
  CORREGIMIENTO: 'Corregimiento',
  VEREDA: 'Vereda',
  BARRIO: 'Barrio',
  CENTRO_POBLADO: 'Centro poblado',
};

export const CANALES: Record<string, string> = {
  FORMULARIO_WEB: 'Formulario web',
  CHATBOT_WEB: 'Chat web',
  TELEGRAM: 'Telegram',
  DIGITADOR: 'Digitador',
  EVENTO: 'Evento',
};

export const ESTADOS: Record<string, string> = {
  ACTIVO: 'Activo',
  EN_REVISION: 'En revisión',
  RETIRADO: 'Retirado',
};
