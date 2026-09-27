export interface Perfil {
  id: string;
  login: string;
  nombres: string;
  apellidos: string;
  roles: string[];
  permisos: string[];
  territorios: { id: number; tipo_codigo: string; nombre: string }[];
}

export interface Indicadores {
  simpatizantes_activos: number;
  registros_hoy: number;
  registros_semana: number;
  miembros_activos: number;
  alertas_abiertas: number | null;
  necesidades_reportadas: number;
}

export interface RegistroDiario {
  fecha: string;
  registros: number;
}

export interface FilaRanking {
  miembro_id: string;
  nombre: string;
  cargo_codigo: string;
  activos: number | null;
  ultimos_7_dias: number | null;
  ultimo_registro: string | null;
  intentos_duplicado: number | null;
}

export interface Metas {
  miembros: {
    miembro_id: string;
    nombre: string | null;
    meta: number;
    fecha_inicio: string;
    fecha_limite: string;
    registrados: number;
    porcentaje: number;
  }[];
  territorios: {
    territorio_id: number;
    territorio: string;
    meta: number;
    fecha_limite: string;
    registrados: number;
    porcentaje: number;
  }[];
}

export interface Necesidades {
  porMunicipio: { municipio_id: number; municipio: string; categoria_codigo: string; categoria: string; cantidad: number }[];
  sinPropuesta: { codigo: string; nombre: string; necesidades: number | null }[];
}

export interface Puesto {
  puesto_id: number;
  puesto: string;
  municipio_id: number;
  potencial_electoral: number | null;
  simpatizantes: number;
  cobertura_pct: number | null;
  lon: number;
  lat: number;
}

export interface Simpatizante {
  persona_id: string;
  nombres: string;
  apellidos: string;
  territorio_residencia_id: number;
  territorio_residencia: string;
  municipio_id: number;
  municipio: string;
  referido_por: string | null;
  canal_codigo: string;
  estado_codigo: string;
  capturado_en: string;
}

export interface Pagina<T> {
  datos: T[];
  total: number;
  pagina: number;
  porPagina: number;
}

export interface MiembroRed {
  miembro_id: string;
  superior_id: string | null;
  cargo_codigo: string;
  nombre: string;
  activo: boolean;
  profundidad: number;
  camino: string[];
  activos: number | null;
  ultimo_registro: string | null;
}

export interface Enlace {
  id: string;
  codigo: string;
  url: string;
  es_principal: boolean;
  activo: boolean;
  creado_en: string;
  expira_en: string | null;
  simpatizantes: number;
}

export interface PropiedadesZona {
  nombre: string;
  tipo: string;
  simpatizantes: number;
  subdivisiones: number;
}

export interface ZonaMapa {
  type: 'Feature';
  id: number;
  geometry: GeoJSON.Geometry | null;
  properties: PropiedadesZona;
}

export interface ColeccionMapa {
  type: 'FeatureCollection';
  features: ZonaMapa[];
}

export interface ResultadoBusqueda {
  id: number;
  tipo: string;
  nombre: string;
  municipio: string | null;
  similitud: number;
}

export interface Politica {
  version: number;
  texto: string;
  finalidades: { codigo: string; descripcion: string }[];
}
