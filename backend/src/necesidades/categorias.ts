/** Categorías de necesidad (participacion.categorias_necesidad). */
export const CATEGORIAS = ['VIAS', 'AGUA', 'SALUD', 'EDUCACION', 'EMPLEO', 'SEGURIDAD', 'VIVIENDA', 'AGRO', 'CONECTIVIDAD', 'AMBIENTE', 'OTRA'] as const;
export type Categoria = (typeof CATEGORIAS)[number];

/** Lo que significa cada categoría: lo usan la IA y las reglas de respaldo. */
export const DEFINICIONES: Record<Categoria, string> = {
  VIAS: 'Vías, carreteras, trochas, puentes, placa huella, transporte y movilidad',
  AGUA: 'Agua potable, acueducto, alcantarillado, pozos, saneamiento básico',
  SALUD: 'Puestos de salud, hospitales, médicos, medicamentos, EPS, ambulancias',
  EDUCACION: 'Escuelas, colegios, docentes, transporte o alimentación escolar, becas, universidad',
  EMPLEO: 'Trabajo, desempleo, oportunidades para jóvenes y mujeres, emprendimiento',
  SEGURIDAD: 'Inseguridad, robos, extorsión, grupos armados, violencia, presencia de la Fuerza Pública',
  VIVIENDA: 'Vivienda nueva, mejoramiento de vivienda, titulación de predios urbanos',
  AGRO: 'Producción campesina, cultivos, ganadería, crédito rural, asistencia técnica, comercialización',
  CONECTIVIDAD: 'Internet, señal de celular, antenas, energía eléctrica',
  AMBIENTE: 'Deforestación, contaminación de ríos, basuras, reciclaje, cambio climático',
  OTRA: 'Cualquier otra necesidad que no encaje en las anteriores',
};

const PALABRAS: Record<Exclude<Categoria, 'OTRA'>, string[]> = {
  VIAS: ['via', 'vias', 'carretera', 'trocha', 'puente', 'placa huella', 'pavimento', 'huecos', 'camino', 'transporte'],
  AGUA: ['agua', 'acueducto', 'alcantarillado', 'potable', 'pozo', 'aljibe', 'saneamiento', 'pozo septico'],
  SALUD: ['salud', 'hospital', 'medico', 'medicamento', 'eps', 'ambulancia', 'enfermer', 'centro de salud'],
  EDUCACION: ['escuela', 'colegio', 'educacion', 'profesor', 'docente', 'universidad', 'beca', 'estudiar', 'restaurante escolar'],
  EMPLEO: ['empleo', 'trabajo', 'desempleo', 'emprend', 'oportunidades'],
  SEGURIDAD: ['seguridad', 'inseguridad', 'robo', 'hurto', 'extorsion', 'violencia', 'policia', 'armados', 'atraco'],
  VIVIENDA: ['vivienda', 'casa', 'techo', 'mejoramiento', 'titulacion', 'arriendo'],
  AGRO: ['agro', 'campesin', 'cultivo', 'ganad', 'cosecha', 'finca', 'cacao', 'semilla', 'credito', 'asistencia tecnica', 'productor'],
  CONECTIVIDAD: ['internet', 'senal', 'celular', 'conectividad', 'wifi', 'antena', 'energia', 'luz electrica'],
  AMBIENTE: ['ambiente', 'ambiental', 'deforestacion', 'basura', 'contaminacion', 'reciclaje', 'rio contaminado'],
};

function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ ]/g, ' ');
}

/**
 * Clasificador de respaldo por palabras clave (sin IA). Confianza baja a
 * propósito: si luego se clasifica con IA, esa clasificación manda.
 */
export function clasificarPorReglas(texto: string): { categoria: Categoria; confianza: number } {
  const t = ` ${normalizar(texto)} `;
  let mejor: Categoria = 'OTRA';
  let puntos = 0;
  let empate = false;
  for (const [categoria, palabras] of Object.entries(PALABRAS) as [Categoria, string[]][]) {
    const p = palabras.filter((palabra) => t.includes(` ${palabra}`)).length;
    if (p > puntos) {
      mejor = categoria;
      puntos = p;
      empate = false;
    } else if (p > 0 && p === puntos) {
      empate = true;
    }
  }
  if (!puntos) return { categoria: 'OTRA', confianza: 0.2 };
  return { categoria: mejor, confianza: empate ? 0.35 : 0.5 };
}

/**
 * Quita del texto lo que pueda identificar a una persona antes de enviarlo a
 * la IA: números largos (cédulas, teléfonos) y correos.
 */
export function anonimizar(texto: string): string {
  return texto
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[correo]')
    .replace(/\+?\d[\d\s.-]{5,}\d/g, '[número]')
    .trim()
    .slice(0, 1000);
}
