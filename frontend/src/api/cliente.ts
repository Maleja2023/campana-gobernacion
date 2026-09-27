const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api';
let unauthorizedHandler: (() => void) | undefined;

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export function configurarCierreDeSesion(handler: () => void) {
  unauthorizedHandler = handler;
}

function mensajeDeError(status: number, body: unknown) {
  if (typeof body === 'object' && body !== null && 'message' in body) {
    const message = (body as { message: unknown }).message;
    if (Array.isArray(message)) return message.join('. ');
    if (typeof message === 'string') return message;
  }
  if (status === 429) return 'Demasiados intentos. Espera un momento y vuelve a intentarlo.';
  if (status === 403) return 'No tienes permiso para realizar esta acción.';
  if (status >= 500) return 'El servidor no pudo completar la solicitud.';
  return 'No fue posible completar la solicitud.';
}

// Rutas del propio flujo de acceso: un 401 aquí no debe intentar renovar (evita
// bucles) ni, en el caso de /auth/yo silenciosa, avisar como si la sesión se
// hubiera caído (para un visitante nuevo, simplemente no hay sesión todavía).
const SIN_RENOVACION = new Set(['/auth/login', '/auth/renovar', '/auth/salir']);

let renovacionEnCurso: Promise<boolean> | null = null;

/** Intenta renovar el token de acceso con la cookie de renovación. Deduplica llamadas simultáneas. */
function renovarSesion(): Promise<boolean> {
  if (!renovacionEnCurso) {
    renovacionEnCurso = fetch(`${API_URL}/auth/renovar`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'campana' },
    })
      .then((res) => res.ok)
      .catch(() => false)
      .finally(() => {
        renovacionEnCurso = null;
      });
  }
  return renovacionEnCurso;
}

interface OpcionesSolicitud extends RequestInit {
  /** No dispara el cierre de sesión global en un 401 (para el chequeo silencioso al cargar la app). */
  silenciosa?: boolean;
}

const TIEMPO_MAXIMO_CONSULTA_MS = 30_000;

async function solicitar<T>(path: string, options: OpcionesSolicitud = {}, reintentando = false): Promise<T> {
  const { silenciosa, ...resto } = options;
  // Las consultas (GET) no esperan para siempre: si la API no contesta, la
  // pantalla lo dice en vez de quedarse cargando. Las escrituras no se cortan.
  const esConsulta = !resto.method || resto.method === 'GET';
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...resto,
      signal: resto.signal ?? (esConsulta ? AbortSignal.timeout(TIEMPO_MAXIMO_CONSULTA_MS) : undefined),
      // La sesión vive en cookies httpOnly: sin esto el navegador ni las manda ni las guarda.
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        // Protección CSRF del backend: un <form> ajeno no puede fijar esta cabecera.
        'X-Requested-With': 'campana',
        ...resto.headers,
      },
    });
  } catch (causa) {
    if (causa instanceof DOMException && causa.name === 'TimeoutError') {
      throw new ApiError(504, 'El servidor no respondió a tiempo. Revise que la API esté encendida y que su ventana no esté en pausa.');
    }
    throw causa;
  }
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => undefined);
  if (!response.ok) {
    if (response.status === 401 && !reintentando && !SIN_RENOVACION.has(path)) {
      const renovado = await renovarSesion();
      if (renovado) return solicitar<T>(path, options, true);
    }
    if (response.status === 401 && !silenciosa) unauthorizedHandler?.();
    throw new ApiError(response.status, mensajeDeError(response.status, body));
  }
  return body as T;
}

/** Como `solicitar`, pero la respuesta exitosa es un archivo (blob), no JSON. */
async function solicitarArchivo(path: string, body: unknown, reintentando = false): Promise<Blob> {
  const response = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'campana' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const errorBody = await response.json().catch(() => undefined);
    if (response.status === 401 && !reintentando) {
      const renovado = await renovarSesion();
      if (renovado) return solicitarArchivo(path, body, true);
    }
    if (response.status === 401) unauthorizedHandler?.();
    throw new ApiError(response.status, mensajeDeError(response.status, errorBody));
  }
  return response.blob();
}

export const cliente = {
  get: <T>(path: string, opciones?: OpcionesSolicitud) => solicitar<T>(path, opciones),
  post: <T>(path: string, body: unknown, opciones?: OpcionesSolicitud) =>
    solicitar<T>(path, { ...opciones, method: 'POST', body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) => solicitar<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  archivo: (path: string, body: unknown) => solicitarArchivo(path, body),
};

/** Estado del proceso de acceso — ver GET /auth/yo. Mientras no sea LISTO, solo /auth/* responde. */
export type EstadoSesion = 'CAMBIAR_CLAVE' | 'MFA_CONFIGURAR' | 'MFA_VERIFICAR' | 'LISTO';

export type Usuario = {
  id: string;
  login: string;
  nombres: string;
  apellidos: string;
  roles: string[];
  permisos: string[];
  territorios: { id: number; tipo_codigo: string; nombre: string }[];
  debeCambiarClave: boolean;
  estado: EstadoSesion;
};

export type LoginResponse = { estado: EstadoSesion };
export type MfaConfiguracion = { otpauthUri: string; qr: string };
export type MfaConfirmacion = { codigosRecuperacion: string[] };
export type ZonaProperties = {
  nombre: string;
  tipo: string;
  simpatizantes: number | null;
  subdivisiones: number | null;
  sinAcceso: boolean;
};
export type FiltrosMapa = { miembroId?: string; desde?: string; hasta?: string };
export type PuntoCalor = { lat: number; lon: number; peso: number };
export type NecesidadZona = { territorio_id: number; total: number; por_categoria: Record<string, number> };
export type BrechaPuesto = {
  puesto_id: number;
  puesto: string;
  municipio_id: number;
  municipio: string;
  potencial_electoral: number | null;
  simpatizantes: number;
  cobertura_pct: string | number | null;
  lat: number | null;
  lon: number | null;
};
export type MiembroFiltro = { miembro_id: string; nombre: string; cargo_codigo: string; municipio: string | null };

/** Cadena de consulta con solo los valores definidos (`?a=1&b=2` o ''). */
export function consulta(valores: Record<string, string | number | undefined | null>): string {
  const partes = Object.entries(valores)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return partes.length ? `?${partes.join('&')}` : '';
}

export type ZonaFeature = GeoJSON.Feature<GeoJSON.Geometry, ZonaProperties> & { id: number };
export type ZonaCollection = GeoJSON.FeatureCollection<GeoJSON.Geometry, ZonaProperties> & {
  features: ZonaFeature[];
  totalSimpatizantes?: number | null;
  totalSinAcceso?: boolean;
};
export type Contorno = { geojson: GeoJSON.Geometry; bbox: [number, number, number, number] };
export type Simpatizante = {
  persona_id: string;
  nombres: string | null;
  apellidos: string | null;
  territorio_residencia: string | null;
  territorio_residencia_id: number | null;
  municipio: string | null;
  municipio_id: number | null;
  referido_por: string | null;
  estado_codigo: string | null;
  capturado_en: string | null;
};
export type ListaSimpatizantes = { datos: Simpatizante[]; total: number; pagina: number; porPagina: number };
export type FiltrosSimpatizantes = {
  territorioId?: number;
  municipioId?: number;
  estado?: string;
  texto?: string;
  liderId?: string;
  desde?: string;
  hasta?: string;
  pagina?: number;
  porPagina?: number;
};
export type EditarSimpatizante = { nombres?: string; apellidos?: string; telefono?: string; territorioId?: number; puestoId?: number };
export type EntradaHistorial = {
  id: number;
  accion: 'REGISTRO' | 'EDICION' | 'RETIRO' | 'REACTIVACION';
  cambios: Record<string, { antes?: string | null; despues?: string | null }>;
  detalle: string | null;
  usuario: string | null;
  ocurrido_en: string;
};
export type CatalogoMunicipio = {
  id: number;
  nombre: string;
  zonas: { id: number; nombre: string; tipo: string }[];
  puestos: { id: number; nombre: string }[];
};
export type LiderRegistro = { miembro_id: string; nombre: string; cargo_codigo: string; codigo_link: string; municipio: string | null };
export type Alerta = {
  id: string;
  tipo_codigo: string;
  tipo_descripcion: string;
  severidad: string;
  estado: string;
  detectada_en: string;
  observacion: string | null;
  resuelta_en: string | null;
  personas: number;
  miembros: number;
};
export type AlertaDetalle = {
  personas: { id: string; nombres: string; apellidos: string; zona: string | null; referido_por: string | null }[];
  miembros: { id: string; nombres: string; apellidos: string; cargo_codigo: string; zona: string | null; referido_por: string | null }[];
};
export type Puesto = { id: number; nombre: string; direccion: string | null; lon: number | null; lat: number | null; simpatizantes?: number | null; potencial_electoral?: number | null; cobertura_pct?: number | null };
export type Indicadores = {
  simpatizantes_activos: number | null;
  registros_hoy: number | null;
  registros_ayer: number | null;
  registros_semana: number | null;
  registros_semana_anterior: number | null;
  registros_mes: number | null;
  meta: number | null;
  avance_pct: string | number | null;
  miembros_activos: number | null;
  lideres_con_registros_semana: number | null;
  alertas_abiertas: number | null;
  necesidades_reportadas: number | null;
};
export type EstadoClasificacion = {
  iaDisponible: boolean;
  modelo: string;
  total: number;
  con_categoria_origen: number;
  clasificadas_modelo: number;
  clasificadas_reglas: number;
  pendientes_modelo: number;
};
export type NecesidadFila = {
  necesidad_id: string;
  descripcion: string;
  territorio: string;
  tipo_territorio: string;
  municipio: string | null;
  categoria: string | null;
  fuente_categoria: 'ORIGEN' | 'IA' | 'REGLAS' | null;
  confianza: string | null;
  origen: string;
  prioridad: string | null;
  reportada_en: string;
};
export type ResumenNecesidad = { municipio_id: number | null; municipio: string | null; categoria: string; cantidad: number };
export type InformeNecesidades = {
  iaDisponible: boolean;
  generando: boolean;
  error: string | null;
  informe: { id: number; generado_en: string; modelo: string; total_necesidades: number; contenido: string; generado_por: string } | null;
};
export type Responsable = { nombre: string; correo: string | null; telefono: string | null };
export type EstadoSolicitudTitular = {
  radicado: string;
  tipo: string;
  estado: 'RECIBIDA' | 'EN_TRAMITE' | 'RESPONDIDA' | 'RECHAZADA';
  recibida_en: string;
  fecha_limite: string;
  respondida_en: string | null;
  respuesta: string | null;
};
export type SolicitudTitular = {
  id: string;
  radicado: string;
  tipo_codigo: 'CONSULTA' | 'ACTUALIZACION' | 'SUPRESION' | 'REVOCATORIA';
  tipo: string;
  estado: EstadoSolicitudTitular['estado'];
  contacto_respuesta: string;
  descripcion: string;
  recibida_en: string;
  fecha_limite: string;
  dias_habiles_restantes: number;
  respondida_en: string | null;
  respuesta: string | null;
  persona_encontrada: boolean;
  nombre: string | null;
};
export type FilaBitacoraAuditoria = {
  id: number;
  ocurrido_en: string;
  usuario: string;
  accion: string;
  esquema: string | null;
  tabla: string | null;
  registro_id: string | null;
  campos: string | null;
  ip: string | null;
};
export type FiltrosReporte = { municipioId?: number; miembroId?: string; desde?: string; hasta?: string };
export type TipoReporte = 'MUNICIPIOS' | 'LIDERES' | 'PUESTOS' | 'PROYECCION' | 'CALIDAD';
export type FilaCalidad = {
  miembro_id: string;
  nombre: string;
  cargo_codigo: string;
  municipio: string | null;
  registros: number;
  con_telefono_pct: string | null;
  con_puesto_pct: string | null;
  con_zona_pct: string | null;
  intentos_duplicado: number;
  personas_en_alertas: number;
  retirados: number;
  completitud: string;
  confiabilidad: string;
  puntaje: number | null;
  nivel: 'ALTA' | 'MEDIA' | 'BAJA' | 'SIN_DATOS';
};
export type FilaReporteMunicipio = {
  municipio_id: number;
  municipio: string;
  simpatizantes: number;
  en_rango: number;
  ultimos_7_dias: number;
  meta: number | null;
  avance_pct: string | null;
  lideres: number;
  lideres_activos_semana: number;
  necesidades: number;
  puestos: number;
  potencial_electoral: number | null;
  cobertura_pct: string | null;
};
export type FilaReporteLider = {
  miembro_id: string;
  nombre: string;
  cargo_codigo: string;
  superior: string | null;
  municipio: string | null;
  activo: boolean;
  propios: number;
  red: number;
  en_rango: number;
  ultimos_7_dias: number;
  ultimos_30_dias: number;
  ultimo_registro: string | null;
  meta: number | null;
  avance_pct: string | null;
  intentos_duplicado: number;
  alertas_abiertas: number;
};
export type FilaReportePuesto = BrechaPuesto & { faltan: number | null };
export type EstadoProyeccion = 'CUMPLIDA' | 'EN_CAMINO' | 'EN_RIESGO' | 'NO_ALCANZA' | 'VENCIDA';
export type FilaProyeccion = {
  tipo: 'MIEMBRO' | 'TERRITORIO';
  referencia: string;
  nombre: string;
  meta: number;
  registrados: number;
  fecha_inicio: string;
  fecha_limite: string;
  dias_restantes: number;
  ritmo_diario: string;
  ritmo_necesario: string | null;
  proyectado: number;
  proyectado_pct: string;
  fecha_estimada: string | null;
  estado: EstadoProyeccion;
};
export type FilaBitacora = {
  id: number;
  exportado_en: string;
  usuario: string;
  recurso: string;
  motivo: string;
  formato: string;
  cantidad_registros: number;
  territorios: string | null;
};
export type RegistroDiario = { fecha: string | null; registros: number | null };
export type LiderRanking = { miembro_id: string | null; nombre: string | null; cargo_codigo: string | null; activos: number | null; ultimos_7_dias: number | null; ultimo_registro: string | null; intentos_duplicado: number | null };
export type MetaMiembro = { miembro_id: string | null; nombre: string | null; meta: number | null; registrados: number | null; porcentaje: number | null; fecha_limite: string | null };
export type MetaTerritorio = { territorio_id: number | null; territorio: string | null; meta: number | null; registrados: number | null; porcentaje: number | null; fecha_limite: string | null };
export type NecesidadMunicipio = { municipio_id: number | null; municipio: string | null; categoria_codigo: string | null; categoria: string | null; cantidad: number | null };
export type NecesidadSinPropuesta = { codigo: string | null; nombre: string | null; necesidades: number | null };
export type AgendaVisita = { id: string; tipo_codigo: string | null; tipo: string | null; nombre: string | null; estado: string | null; con_candidato: boolean | null; inicia_en: string | null; termina_en: string | null; territorio: string | null; ruta: string | null; asistentes_aprox: number | null; resumen: string | null; lideres_presentes: number | null; organizaciones: number | null; planteamientos: number | null; compromisos: number | null };
export type AgendaCompromiso = { id: string; descripcion: string | null; estado: string | null; categoria: string | null; ruta: string | null; visita: string | null; propuesta: string | null; dias_abierto: number | null; municipio_id: number | null; evento_id: string | null };
export type AgendaCatalogos = { eventos: { codigo: string; nombre: string }[]; organizaciones: { codigo: string; nombre: string }[]; categorias: { codigo: string; nombre: string }[]; propuestas: { id: string; titulo: string }[] };
export type AgendaDetalle = { visita: AgendaVisita; lideres: { nombre: string; cargo: string }[]; organizaciones: { nombre: string; tipo: string }[]; planteamientos: { id: string; descripcion: string; categoria_codigo: string | null; prioridad: string | null }[]; compromisos: AgendaCompromiso[] };
export type TerritorioCatalogo = { id: number; nombre: string; codigo_oficial: string | null };
export type MiembroRed = {
  miembro_id: string;
  superior_id: string | null;
  cargo_codigo: string;
  nombre: string;
  activo: boolean;
  profundidad: number;
  camino: string[];
  activos: number | null;
  ultimo_registro: string | null;
  /** true en la fila de la persona que tiene la sesión. */
  es_propio?: boolean;
};
export type LinkRegistro = {
  valido: boolean;
  lider?: string;
  /** Nombre completo y cargo de quien invita. */
  invita?: string;
  cargo?: string;
  /** VOTANTE: registro de simpatizante. LIDER: además, solicitud para ser líder o sublíder. */
  proposito?: 'VOTANTE' | 'LIDER';
  cargoInvitado?: 'LIDER' | 'SUBLIDER' | null;
};
export type EnlaceLideres = { codigo: string; url: string; cargoInvitado: 'LIDER' | 'SUBLIDER'; pendientes: number };
export type SolicitudLider = {
  id: string;
  persona_id: string;
  nombre: string;
  invita: string;
  invita_id: string;
  cargo_propuesto: 'LIDER' | 'SUBLIDER';
  zona_trabajo: string | null;
  municipio: string | null;
  meta_propuesta: number | null;
  organizacion: string | null;
  estado: 'PENDIENTE' | 'APROBADA' | 'RECHAZADA';
  creada_en: string;
  resuelta_en: string | null;
  observacion: string | null;
  es_propia: boolean;
  telefono: string | null;
};
export type PoliticaRegistro = { version: number; texto: string; finalidades: { codigo: string; descripcion: string }[] };
export type RegistroRespuesta = { resultado: string; mensaje: string; persona_id?: string | null };
export type MiLink = {
  id: string;
  codigo: string;
  url: string;
  es_principal: boolean;
  activo: boolean;
  creado_en: string;
  expira_en: string | null;
  simpatizantes: number;
};
export type NuevoLink = { codigo: string; url: string; es_principal: boolean; expira_en: string | null };
export type NuevoMiembroRespuesta = { miembroId: string; codigoLink: string; urlLink: string };
export type RolAsignable = { codigo: string; nombre: string; descripcion: string };
export type UsuarioFila = {
  id: string;
  login: string;
  nombres: string;
  apellidos: string;
  activo: boolean;
  debe_cambiar_clave: boolean;
  roles: { codigo: string; nombre: string }[];
  territorios: { id: number; nombre: string }[];
  cargo: string | null;
  ultimo_ingreso: string | null;
};
export type ListaUsuarios = { datos: UsuarioFila[]; total: number; pagina: number; porPagina: number };
export type NuevoUsuario = { usuarioId: string; login: string; claveTemporal: string };
export type ClaveTemporal = { claveTemporal: string };
export type DocumentoDescifrado = { documento: string };

export const api = {
  iniciarSesion: (login: string, clave: string) => cliente.post<LoginResponse>('/auth/login', { login, clave }),
  // Silenciosa: al cargar la app esto se llama sin saber si hay sesión; un 401
  // significa simplemente "todavía no ha iniciado sesión", no un cierre inesperado.
  perfil: () => cliente.get<Usuario>('/auth/yo', { silenciosa: true }),
  cambiarClave: (claveActual: string, claveNueva: string) => cliente.post<{ mensaje: string }>('/auth/cambiar-clave', { claveActual, claveNueva }),
  salir: () => cliente.post<void>('/auth/salir', {}),
  mfaConfigurar: () => cliente.post<MfaConfiguracion>('/auth/mfa/configurar', {}),
  mfaConfirmar: (codigo: string) => cliente.post<MfaConfirmacion>('/auth/mfa/confirmar', { codigo }),
  mfaVerificar: (codigo: string) => cliente.post<{ estado: EstadoSesion }>('/auth/mfa/verificar', { codigo }),
  mfaRecuperacion: (codigo: string) => cliente.post<{ mensaje: string }>('/auth/mfa/recuperacion', { codigo }),
  mfaCodigos: (codigo: string) => cliente.post<MfaConfirmacion>('/auth/mfa/codigos', { codigo }),
  mapa: (padre?: number, filtros: FiltrosMapa = {}) => cliente.get<ZonaCollection>(`/territorio/mapa${consulta({ padre, ...filtros })}`),
  mapaCalor: (municipioId: number | undefined, filtros: FiltrosMapa = {}) =>
    cliente.get<PuntoCalor[]>(`/territorio/mapa/calor${consulta({ municipioId, ...filtros })}`),
  mapaNecesidades: (padre: number | undefined, categoria?: string) =>
    cliente.get<NecesidadZona[]>(`/territorio/mapa/necesidades${consulta({ padre, categoria })}`),
  mapaBrecha: (municipioId: number | undefined, filtros: FiltrosMapa = {}) =>
    cliente.get<BrechaPuesto[]>(`/territorio/mapa/brecha${consulta({ municipioId, ...filtros })}`),
  mapaMiembros: () => cliente.get<MiembroFiltro[]>('/territorio/mapa/miembros'),
  puestos: (municipioId: number) => cliente.get<Puesto[]>(`/tablero/puestos?municipioId=${municipioId}`),
  /** Catálogo público de puestos de un municipio (formularios de registro; no exige sesión). */
  puestosCatalogo: (municipioId: number) => cliente.get<Puesto[]>(`/territorio/puestos?municipioId=${municipioId}`),
  contorno: () => cliente.get<Contorno>('/territorio/contorno'),
  simpatizantes: (territorioId: number, pagina = 1) => cliente.get<ListaSimpatizantes>(`/simpatizantes?territorioId=${territorioId}&pagina=${pagina}&porPagina=20`),
  listarSimpatizantes: (filtros: FiltrosSimpatizantes) => {
    const q = new URLSearchParams();
    if (filtros.territorioId !== undefined) q.set('territorioId', String(filtros.territorioId));
    if (filtros.municipioId !== undefined) q.set('municipioId', String(filtros.municipioId));
    if (filtros.estado) q.set('estado', filtros.estado);
    if (filtros.texto) q.set('texto', filtros.texto);
    if (filtros.liderId) q.set('liderId', filtros.liderId);
    if (filtros.desde) q.set('desde', filtros.desde);
    if (filtros.hasta) q.set('hasta', filtros.hasta);
    q.set('pagina', String(filtros.pagina ?? 1));
    q.set('porPagina', String(filtros.porPagina ?? 20));
    return cliente.get<ListaSimpatizantes>(`/simpatizantes?${q.toString()}`);
  },
  editarSimpatizante: (personaId: string, body: EditarSimpatizante) => cliente.patch<{ mensaje: string }>(`/simpatizantes/${personaId}`, body),
  retirarSimpatizante: (personaId: string, motivo: string) => cliente.post<{ mensaje: string }>(`/simpatizantes/${personaId}/retirar`, { motivo }),
  reactivarSimpatizante: (personaId: string) => cliente.post<{ mensaje: string }>(`/simpatizantes/${personaId}/reactivar`, {}),
  historialSimpatizante: (personaId: string) => cliente.get<EntradaHistorial[]>(`/simpatizantes/${personaId}/historial`),
  catalogoRegistro: () => cliente.get<CatalogoMunicipio[]>('/territorio/catalogo-registro'),
  lideresRegistro: () => cliente.get<LiderRegistro[]>('/simpatizantes/lideres-registro'),
  responsableDatos: () => cliente.get<Responsable>('/titular/responsable'),
  radicarSolicitudTitular: (body: { tipo: string; documento: string; contacto: string; descripcion: string; captcha?: string }) =>
    cliente.post<{ radicado: string; fechaLimite: string }>('/titular/solicitudes', body),
  estadoSolicitudTitular: (body: { radicado: string; documento: string }) => cliente.post<EstadoSolicitudTitular>('/titular/estado', body),
  bajaMensajes: (body: { documento: string; canal?: string; captcha?: string }) => cliente.post<{ mensaje: string }>('/titular/baja', body),
  solicitudesTitular: (estado?: string) => cliente.get<SolicitudTitular[]>(`/cumplimiento/solicitudes${consulta({ estado })}`),
  datosTitular: (id: string) => cliente.get<Record<string, unknown> | null>(`/cumplimiento/solicitudes/${id}/datos`),
  tramitarSolicitudTitular: (id: string, accion: string, respuesta?: string) =>
    cliente.post<{ id: string; accion: string }>(`/cumplimiento/solicitudes/${id}/tramitar`, { accion, respuesta }),
  bitacoraAuditoria: (f: { usuario?: string; accion?: string; tabla?: string; desde?: string; hasta?: string; pagina?: number }) =>
    cliente.get<{ datos: FilaBitacoraAuditoria[]; total: number; pagina: number; porPagina: number }>(`/auditoria/bitacora${consulta(f)}`),
  configuracionRegistro: () => cliente.get<{ captchaSiteKey: string | null }>('/registro/configuracion'),
  documentoSimpatizante: (personaId: string) => cliente.get<DocumentoDescifrado>(`/simpatizantes/${personaId}/documento`),
  necesidadesEstado: () => cliente.get<EstadoClasificacion>('/necesidades/clasificacion'),
  necesidadesClasificar: () => cliente.post<{ modelo: string; clasificadas: number; fallidas: number }>('/necesidades/clasificar', {}),
  necesidadesListado: (f: { municipioId?: number; categoria?: string; pagina?: number }) =>
    cliente.get<{ datos: NecesidadFila[]; total: number; pagina: number; porPagina: number }>(`/necesidades${consulta({ ...f, porPagina: 30 })}`),
  necesidadesResumen: () => cliente.get<ResumenNecesidad[]>('/necesidades/resumen'),
  necesidadCorregir: (id: string, categoria: string) => cliente.patch<{ id: string; categoria: string }>(`/necesidades/${id}/categoria`, { categoria }),
  necesidadesInforme: (municipioId: number) => cliente.get<InformeNecesidades>(`/necesidades/informes/${municipioId}`),
  necesidadesGenerarInforme: (municipioId: number) => cliente.post<InformeNecesidades>(`/necesidades/informes/${municipioId}`, {}),
  reporteMunicipios: (f: FiltrosReporte) => cliente.get<FilaReporteMunicipio[]>(`/reportes/municipios${consulta(f)}`),
  reporteLideres: (f: FiltrosReporte) => cliente.get<FilaReporteLider[]>(`/reportes/lideres${consulta(f)}`),
  reportePuestos: (f: FiltrosReporte) => cliente.get<FilaReportePuesto[]>(`/reportes/puestos${consulta(f)}`),
  reporteCalidad: (f: FiltrosReporte) => cliente.get<FilaCalidad[]>(`/reportes/calidad${consulta(f)}`),
  proyeccionMetas: () => cliente.get<FilaProyeccion[]>('/reportes/proyeccion'),
  exportarReporte: (body: FiltrosReporte & { reporte: TipoReporte; motivo: string }) => cliente.archivo('/reportes/exportar', body),
  bitacoraExportaciones: () => cliente.get<FilaBitacora[]>('/reportes/exportaciones?limite=200'),
  exportarSimpatizantes: (body: { motivo: string; territorioId?: number; municipioId?: number; estado?: string; texto?: string }) =>
    cliente.archivo('/simpatizantes/exportar', body),
  alertas: (estado?: string) => cliente.get<Alerta[]>(`/calidad/alertas${estado ? `?estado=${estado}` : ''}`),
  alertaDetalle: (id: string) => cliente.get<AlertaDetalle>(`/calidad/alertas/${id}`),
  resolverAlerta: (id: string, body: { estado: 'RESUELTA' | 'DESCARTADA'; observacion: string }) =>
    cliente.patch<{ mensaje: string }>(`/calidad/alertas/${id}`, body),
  indicadores: () => cliente.get<Indicadores>('/tablero/indicadores'),
  registrosDiarios: (desde: string, hasta: string) => cliente.get<RegistroDiario[]>(`/tablero/registros-diarios?desde=${desde}&hasta=${hasta}`),
  ranking: (limite = 10) => cliente.get<LiderRanking[]>(`/tablero/ranking?limite=${limite}`),
  lideresInactivos: () => cliente.get<LiderRanking[]>('/tablero/lideres-inactivos'),
  configuracionTablero: () => cliente.get<{ liderInactivoDias: number }>('/tablero/configuracion'),
  metas: () => cliente.get<{ miembros: MetaMiembro[]; territorios: MetaTerritorio[] }>('/tablero/metas'),
  necesidades: () => cliente.get<{ porMunicipio: NecesidadMunicipio[]; sinPropuesta: NecesidadSinPropuesta[] }>('/tablero/necesidades'),
  agendaVisitas: (query = '') => cliente.get<{ datos: AgendaVisita[]; total: number; pagina: number; porPagina: number }>(`/agenda/visitas${query ? `?${query}` : ''}`),
  agendaDetalle: (id: string) => cliente.get<AgendaDetalle>(`/agenda/visitas/${id}`),
  agendaCrearVisita: (body: unknown) => cliente.post<{ id: string }>('/agenda/visitas', body),
  agendaActualizarVisita: (id: string, body: unknown) => cliente.patch<{ id: string }>(`/agenda/visitas/${id}`, body),
  agendaPlanteamiento: (id: string, body: unknown) => cliente.post<{ id: string }>(`/agenda/visitas/${id}/planteamientos`, body),
  agendaCompromisos: (query = '') => cliente.get<AgendaCompromiso[]>(`/agenda/compromisos${query ? `?${query}` : ''}`),
  agendaCrearCompromiso: (body: unknown) => cliente.post<{ id: string }>('/agenda/compromisos', body),
  agendaActualizarCompromiso: (id: string, body: unknown) => cliente.patch<AgendaCompromiso>(`/agenda/compromisos/${id}`, body),
  agendaCobertura: (padre?: number) => cliente.get<GeoJSON.FeatureCollection>(padre ? `/agenda/cobertura?padre=${padre}` : '/agenda/cobertura'),
  agendaCatalogos: () => cliente.get<AgendaCatalogos>('/agenda/catalogos'),
  reportarNecesidad: (body: unknown) => cliente.post<{ id: string }>('/agenda/reportes-comunitarios', body),
  misReportes: () => cliente.get<{ id: string; territorio_id: number; descripcion: string; categoria_codigo: string; prioridad: string; reportada_en: string }[]>('/agenda/reportes-comunitarios/mios'),
  municipios: () => cliente.get<TerritorioCatalogo[]>('/territorio/municipios'),
  buscarTerritorio: (texto: string, padre?: number) => cliente.get<{ id: number; tipo: string; nombre: string; municipio: string | null }[]>(`/territorio/buscar?q=${encodeURIComponent(texto)}${padre ? `&padre=${padre}` : ''}`),
  redArbol: () => cliente.get<MiembroRed[]>('/red/arbol'),
  misLinks: () => cliente.get<MiLink[]>('/red/mis-links'),
  crearLink: (expiraEn?: string) => cliente.post<NuevoLink>('/red/mis-links', expiraEn ? { expiraEn } : {}),
  actualizarLink: (linkId: string, activo: boolean) => cliente.patch<{ id: string; activo: boolean }>(`/red/links/${linkId}`, { activo }),
  crearMiembro: (body: {
    documento: string;
    nombres: string;
    apellidos: string;
    telefono?: string;
    cargo: 'COORDINADOR' | 'LIDER' | 'SUBLIDER';
    superiorId: string;
    territorioIds?: number[];
  }) => cliente.post<NuevoMiembroRespuesta>('/red/miembros', body),
  actualizarMiembro: (miembroId: string, body: { activo?: boolean; superiorId?: string }) =>
    cliente.patch<{ id: string; activo: boolean; superior_id: string | null }>(`/red/miembros/${miembroId}`, body),
  crearMetaMiembro: (body: { miembroId: string; cantidad: number; fechaInicio: string; fechaLimite: string }) =>
    cliente.post<unknown>('/red/metas/miembro', body),
  crearMetaTerritorio: (body: { territorioId: number; cantidad: number; fechaInicio: string; fechaLimite: string }) =>
    cliente.post<unknown>('/red/metas/territorio', body),
  enlaceLideres: () => cliente.get<EnlaceLideres | null>('/red/enlace-lideres'),
  solicitudesLider: (estado?: string) => cliente.get<SolicitudLider[]>(`/red/solicitudes${consulta({ estado })}`),
  resolverSolicitudLider: (id: string, aprobar: boolean, observacion?: string) =>
    cliente.post<{ aprobada: boolean; miembroId: string | null; codigoLink: string | null; urlLink: string | null }>(`/red/solicitudes/${id}/resolver`, {
      aprobar,
      observacion,
    }),
  validarLink: (codigo: string) => cliente.get<LinkRegistro>(`/registro/link/${encodeURIComponent(codigo)}`),
  politicaRegistro: () => cliente.get<PoliticaRegistro>('/registro/politica'),
  registroPublico: (body: unknown) => cliente.post<RegistroRespuesta>('/registro', body),
  registroInterno: (body: unknown) => cliente.post<RegistroRespuesta>('/simpatizantes', body),
  usuarios: (filtros: { texto?: string; activo?: boolean; pagina?: number; porPagina?: number }) => {
    const q = new URLSearchParams();
    if (filtros.texto) q.set('texto', filtros.texto);
    if (filtros.activo !== undefined) q.set('activo', String(filtros.activo));
    q.set('pagina', String(filtros.pagina ?? 1));
    q.set('porPagina', String(filtros.porPagina ?? 20));
    return cliente.get<ListaUsuarios>(`/usuarios?${q.toString()}`);
  },
  rolesAsignables: () => cliente.get<RolAsignable[]>('/usuarios/roles-asignables'),
  crearUsuario: (body: { login: string; roles: string[]; territorioIds: number[]; miembroId?: string; documento?: string; nombres?: string; apellidos?: string }) =>
    cliente.post<NuevoUsuario>('/usuarios', body),
  actualizarUsuario: (usuarioId: string, body: { activo?: boolean; roles?: string[]; territorioIds?: number[] }) =>
    cliente.patch<{ usuarioId: string; activo: boolean; roles: string[]; territorioIds: number[] }>(`/usuarios/${usuarioId}`, body),
  restablecerClave: (usuarioId: string) => cliente.post<ClaveTemporal>(`/usuarios/${usuarioId}/restablecer-clave`, {}),
  restablecerMfa: (usuarioId: string) => cliente.post<{ mensaje: string }>(`/usuarios/${usuarioId}/restablecer-mfa`, {}),
};
