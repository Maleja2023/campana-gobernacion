import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/cliente';
import { Captcha } from '../componentes/Captcha';
import { Cargando } from '../componentes/Estados';
import { Icono } from '../componentes/Icono';
import { nombrePropio } from '../util/nombres';

type Datos = {
  nombres: string;
  apellidos: string;
  documento: string;
  telefono: string;
  municipioId: string;
  municipioNombre: string;
  territorioId: string;
  territorioNombre: string;
  puestoId: string;
  puestoNombre: string;
  necesidad: string;
  aceptaComunicaciones: boolean;
  // Solo por el enlace de líderes
  zonaTrabajoId: string;
  zonaTrabajoNombre: string;
  metaPropuesta: string;
  organizacion: string;
};

const inicial: Datos = {
  nombres: '',
  apellidos: '',
  documento: '',
  telefono: '',
  municipioId: '',
  municipioNombre: '',
  territorioId: '',
  territorioNombre: '',
  puestoId: '',
  puestoNombre: '',
  necesidad: '',
  aceptaComunicaciones: false,
  zonaTrabajoId: '',
  zonaTrabajoNombre: '',
  metaPropuesta: '',
  organizacion: '',
};

type Paso = 'nombre' | 'cedula' | 'celular' | 'municipio' | 'vereda' | 'puesto' | 'necesidad' | 'zona' | 'meta' | 'organizacion' | 'autorizacion' | 'resumen';
const PASOS_VOTANTE: Paso[] = ['nombre', 'cedula', 'celular', 'municipio', 'vereda', 'puesto', 'necesidad', 'autorizacion', 'resumen'];
// Por el enlace de líderes, además, tres preguntas sobre su trabajo como líder.
const PASOS_LIDER: Paso[] = ['nombre', 'cedula', 'celular', 'municipio', 'vereda', 'puesto', 'necesidad', 'zona', 'meta', 'organizacion', 'autorizacion', 'resumen'];

const CARGO_INVITA: Record<string, string> = { GERENTE: 'gerente', COORDINADOR: 'coordinador', LIDER: 'líder', SUBLIDER: 'sublíder' };
const METAS = ['10', '25', '50', '100', '200'];
const ORGANIZACIONES = [
  'Junta de Acción Comunal',
  'Asociación campesina o de productores',
  'Organización de mujeres',
  'Organización juvenil',
  'Iglesia o grupo religioso',
  'Gremio o sindicato',
  'Otra organización',
  'Ninguna',
];

export function RegistroPublicoPage() {
  const { codigo = '' } = useParams();
  const link = useQuery({ queryKey: ['registro-link', codigo], queryFn: () => api.validarLink(codigo), enabled: Boolean(codigo) });
  const municipios = useQuery({ queryKey: ['registro-municipios'], queryFn: api.municipios });
  const politica = useQuery({ queryKey: ['registro-politica'], queryFn: api.politicaRegistro });
  const configuracion = useQuery({ queryKey: ['registro-configuracion'], queryFn: api.configuracionRegistro });

  const [step, setStep] = useState(0);
  const [zonaResultados, setZonaResultados] = useState<{ id: number; nombre: string }[]>([]);
  const [datos, setDatos] = useState(inicial);
  const [veredaResultados, setVeredaResultados] = useState<{ id: number; nombre: string }[]>([]);
  const [aceptaPolitica, setAceptaPolitica] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [ubicacion, setUbicacion] = useState<{ lon: number; lat: number } | null>(null);
  const [estadoUbicacion, setEstadoUbicacion] = useState<'' | 'buscando' | 'error'>('');

  const puestos = useQuery({
    queryKey: ['registro-puestos', datos.municipioId],
    queryFn: () => api.puestosCatalogo(Number(datos.municipioId)),
    enabled: Boolean(datos.municipioId) && step >= 5,
  });

  if (link.isPending) {
    return (
      <div className="chat-page">
        <Cargando texto="Validando tu enlace..." />
      </div>
    );
  }
  if (link.isError) {
    return (
      <div className="chat-page">
        <div className="chat-error">No fue posible validar este enlace. Inténtalo de nuevo más tarde.</div>
      </div>
    );
  }
  if (!link.data?.valido) {
    return (
      <div className="chat-page">
        <div className="chat-error">
          <h1>Este enlace no está activo</h1>
          <p>Pídele uno nuevo a quien te lo compartió.</p>
        </div>
      </div>
    );
  }
  const esLider = link.data.proposito === 'LIDER';
  const pasos = esLider ? PASOS_LIDER : PASOS_VOTANTE;
  const ULTIMO_STEP = pasos.length - 1;
  const paso = pasos[step];
  /** true si ya se respondió el paso (su burbuja se muestra en la conversación). */
  const respondido = (p: Paso) => step > pasos.indexOf(p);
  const invita = link.data.invita ? nombrePropio(link.data.invita) : link.data.lider ? nombrePropio(link.data.lider) : 'Un miembro de la campaña';
  const cargoInvita = link.data.cargo ? CARGO_INVITA[link.data.cargo] : null;
  const rolInvitado = link.data.cargoInvitado === 'SUBLIDER' ? 'sublíder' : 'líder';
  const saludo = esLider
    ? `Hola. ${invita}${cargoInvita ? `, ${cargoInvita} de la campaña,` : ''} te invita a unirte a su equipo como ${rolInvitado}. Primero te registraremos y luego te haré unas preguntas sobre tu trabajo como ${rolInvitado}.`
    : `Hola. ${invita}${cargoInvita ? `, ${cargoInvita} de la campaña,` : ''} te invita a registrarte como simpatizante. Te haré unas preguntas cortas.`;

  function ir(destino: number) {
    setError('');
    setStep(destino);
  }
  function avanzar() {
    ir(Math.min(step + 1, ULTIMO_STEP));
  }
  function atras() {
    ir(Math.max(0, step - 1));
  }

  function elegirMunicipio(id: string) {
    const nombre = municipios.data?.find((m) => String(m.id) === id)?.nombre ?? '';
    // Por defecto la residencia queda a nivel de municipio; el paso de la
    // vereda/barrio, si el usuario encuentra la suya, la refina.
    setDatos({ ...datos, municipioId: id, municipioNombre: nombre, territorioId: id, territorioNombre: nombre });
  }

  async function buscarVereda(texto: string) {
    setVeredaResultados(texto.length >= 3 ? await api.buscarTerritorio(texto, Number(datos.municipioId)) : []);
  }

  function elegirVereda(id: string, nombre: string) {
    setDatos({ ...datos, territorioId: id, territorioNombre: nombre });
    setVeredaResultados([]);
    avanzar();
  }

  function compartirUbicacion() {
    if (!navigator.geolocation) {
      setEstadoUbicacion('error');
      return;
    }
    setEstadoUbicacion('buscando');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        // Cinco decimales (~1 m) bastan para ubicar el sector.
        const redondear = (v: number) => Math.round(v * 1e5) / 1e5;
        setUbicacion({ lon: redondear(pos.coords.longitude), lat: redondear(pos.coords.latitude) });
        setEstadoUbicacion('');
      },
      () => setEstadoUbicacion('error'),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    );
  }

  async function buscarZona(texto: string) {
    setZonaResultados(texto.length >= 3 ? await api.buscarTerritorio(texto, Number(datos.municipioId)) : []);
  }

  function elegirZona(id: string, nombre: string) {
    setDatos({ ...datos, zonaTrabajoId: id, zonaTrabajoNombre: nombre });
    setZonaResultados([]);
    avanzar();
  }

  const textoZona = datos.zonaTrabajoId ? nombrePropio(datos.zonaTrabajoNombre) : 'Sin zona definida';
  const textoMeta = datos.metaPropuesta ? `${datos.metaPropuesta} personas` : 'Aún no sé';

  function elegirPuesto(id: string) {
    const nombre = puestos.data?.find((p) => String(p.id) === id)?.nombre ?? '';
    setDatos({ ...datos, puestoId: id, puestoNombre: nombre });
  }

  async function enviar(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (!politica.data) return;
    const siteKey = configuracion.data?.captchaSiteKey;
    if (siteKey && !captcha) {
      setError('Confirma que no eres un robot antes de enviar.');
      return;
    }
    setCargando(true);
    try {
      const respuesta = await api.registroPublico({
        codigoLink: codigo,
        documento: datos.documento,
        nombres: datos.nombres,
        apellidos: datos.apellidos,
        telefono: datos.telefono || undefined,
        territorioId: Number(datos.territorioId),
        puestoId: datos.puestoId ? Number(datos.puestoId) : undefined,
        necesidad: datos.necesidad.trim() || undefined,
        lon: ubicacion?.lon,
        lat: ubicacion?.lat,
        captcha: captcha ?? undefined,
        finalidades: ['ORGANIZACION_CAMPANA', ...(datos.aceptaComunicaciones ? ['COMUNICACIONES'] : [])],
        politicaVersion: politica.data.version,
        aceptaPolitica: true,
        canal: 'CHATBOT_WEB',
        lider: esLider
          ? {
              zonaTrabajoId: datos.zonaTrabajoId ? Number(datos.zonaTrabajoId) : undefined,
              metaPropuesta: datos.metaPropuesta ? Number(datos.metaPropuesta) : undefined,
              organizacion: datos.organizacion || undefined,
            }
          : undefined,
      });
      void respuesta;
      setEnviado(true);
    } catch (cause) {
      // Un token de captcha sirve una sola vez: tras un error hay que resolverlo de nuevo.
      setCaptcha(null);
      setError(
        cause instanceof Error && cause.message.includes('Demasiados')
          ? 'Estás enviando muchas solicitudes, espera un minuto.'
          : cause instanceof Error
            ? cause.message
            : 'No fue posible enviar tu registro.',
      );
    } finally {
      setCargando(false);
    }
  }

  if (enviado) {
    return (
      <main className="chat-page">
        <section className="chat-card success-chat">
          <span className="brand-mark"><Icono nombre="escudo" tamano={19} /></span>
          <h1>Gracias por participar</h1>
          <p>Tu registro fue recibido correctamente.</p>
          {esLider && (
            <p>
              Tu solicitud para ser {rolInvitado} quedó en manos de {invita}. Cuando la apruebe, te contactará y recibirás tu propio enlace para sumar
              personas.
            </p>
          )}
          <p className="helper">
            Puedes consultar, corregir o pedir que borremos tus datos, o dejar de recibir mensajes, en <Link to="/mis-datos">Mis datos</Link>.
          </p>
        </section>
      </main>
    );
  }

  const veredaEsDistinta = datos.territorioId !== datos.municipioId;

  return (
    <main className="chat-page">
      <section className="chat-card">
        <header className="chat-header">
          <span className="brand-mark"><Icono nombre="escudo" tamano={19} /></span>
          <div>
            <strong>Campaña Gobernación</strong>
            <small>Registro seguro</small>
          </div>
        </header>

        <div className="chat-log" aria-live="polite">
          <div className="bubble system">{saludo}</div>
          {respondido('nombre') && <div className="bubble system">¿Cuáles son tus nombres y apellidos?</div>}
          {respondido('nombre') && (
            <div className="bubble person">
              {datos.nombres} {datos.apellidos}
            </div>
          )}
          {respondido('cedula') && <div className="bubble system">¿Cuál es tu número de cédula?</div>}
          {respondido('cedula') && <div className="bubble person">{datos.documento}</div>}
          {respondido('celular') && <div className="bubble system">¿Cuál es tu celular? Es opcional.</div>}
          {respondido('celular') && <div className="bubble person">{datos.telefono || 'Prefiero no darlo'}</div>}
          {respondido('municipio') && <div className="bubble system">¿En qué municipio vives?</div>}
          {respondido('municipio') && <div className="bubble person">{nombrePropio(datos.municipioNombre)}</div>}
          {respondido('vereda') && <div className="bubble system">¿En qué vereda o barrio?</div>}
          {respondido('vereda') && <div className="bubble person">{veredaEsDistinta ? nombrePropio(datos.territorioNombre) : 'No la encontró en la búsqueda'}</div>}
          {respondido('puesto') && <div className="bubble system">¿En qué puesto de votación estás inscrito?</div>}
          {respondido('puesto') && <div className="bubble person">{datos.puestoNombre ? nombrePropio(datos.puestoNombre) : 'No sé, lo consulto después'}</div>}
          {respondido('necesidad') && <div className="bubble system">¿Cuál es la principal necesidad de tu vereda o barrio?</div>}
          {respondido('necesidad') && <div className="bubble person">{datos.necesidad.trim() || 'Prefiero no decirla ahora'}</div>}
          {esLider && respondido('necesidad') && !respondido('zona') && (
            <div className="bubble system">Ahora, unas preguntas sobre tu trabajo como {rolInvitado}.</div>
          )}
          {respondido('zona') && <div className="bubble system">¿En qué vereda o barrio vas a trabajar con tu equipo?</div>}
          {respondido('zona') && <div className="bubble person">{textoZona}</div>}
          {respondido('meta') && <div className="bubble system">¿Cuántas personas crees que puedes sumar a la campaña?</div>}
          {respondido('meta') && <div className="bubble person">{textoMeta}</div>}
          {respondido('organizacion') && <div className="bubble system">¿Haces parte de alguna organización de tu comunidad?</div>}
          {respondido('organizacion') && <div className="bubble person">{datos.organizacion || 'Prefiero no decirlo'}</div>}
          {paso === 'zona' && <div className="bubble system">¿En qué vereda o barrio vas a trabajar con tu equipo?</div>}
          {paso === 'meta' && <div className="bubble system">¿Cuántas personas crees que puedes sumar a la campaña?</div>}
          {paso === 'organizacion' && <div className="bubble system">¿Haces parte de alguna organización de tu comunidad?</div>}
        </div>

        <form onSubmit={step === ULTIMO_STEP ? enviar : (e) => { e.preventDefault(); avanzar(); }} className="chat-form">
          {paso === 'nombre' && (
            <>
              <label>
                Nombres
                <input autoFocus value={datos.nombres} onChange={(e) => setDatos({ ...datos, nombres: e.target.value })} minLength={2} required />
              </label>
              <label>
                Apellidos
                <input value={datos.apellidos} onChange={(e) => setDatos({ ...datos, apellidos: e.target.value })} minLength={2} required />
              </label>
            </>
          )}

          {paso === 'cedula' && (
            <label>
              Número de cédula
              <input
                autoFocus
                inputMode="numeric"
                pattern="[0-9]{5,10}"
                value={datos.documento}
                onChange={(e) => setDatos({ ...datos, documento: e.target.value.replace(/\D/g, '') })}
                required
              />
            </label>
          )}

          {paso === 'celular' && (
            <>
              <label>
                Celular <span className="optional">opcional</span>
                <input
                  autoFocus
                  inputMode="tel"
                  pattern="3[0-9]{9}"
                  value={datos.telefono}
                  onChange={(e) => setDatos({ ...datos, telefono: e.target.value.replace(/\D/g, '') })}
                />
              </label>
              <button type="button" className="choice-button" onClick={() => { setDatos({ ...datos, telefono: '' }); avanzar(); }}>
                Prefiero no darlo
              </button>
            </>
          )}

          {paso === 'municipio' && (
            <label>
              Municipio
              <select autoFocus value={datos.municipioId} onChange={(e) => elegirMunicipio(e.target.value)} required>
                <option value="">Selecciona uno</option>
                {municipios.data?.map((m) => (
                  <option key={m.id} value={m.id}>
                    {nombrePropio(m.nombre)}
                  </option>
                ))}
              </select>
            </label>
          )}

          {paso === 'vereda' && (
            <>
              <label>
                Busca tu vereda o barrio
                <input autoFocus placeholder="Escribe el nombre" onChange={(e) => void buscarVereda(e.target.value)} />
              </label>
              <div className="choice-list">
                {veredaResultados.map((t) => (
                  <button type="button" key={t.id} onClick={() => elegirVereda(String(t.id), t.nombre)}>
                    {nombrePropio(t.nombre)}
                  </button>
                ))}
                <button type="button" className="choice-button" onClick={avanzar}>
                  Mi vereda o barrio no aparece
                </button>
              </div>
            </>
          )}

          {paso === 'puesto' && (
            <label>
              Puesto de votación
              <select autoFocus value={datos.puestoId} onChange={(e) => elegirPuesto(e.target.value)}>
                <option value="">No sé / lo consulto después</option>
                {puestos.data?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {nombrePropio(p.nombre)}
                  </option>
                ))}
              </select>
              <small>
                También puedes consultarlo en la{' '}
                <a href="https://www.registraduria.gov.co/" target="_blank" rel="noreferrer">
                  Registraduría
                </a>
                .
              </small>
            </label>
          )}

          {paso === 'necesidad' && (
            <>
              <label>
                Necesidad principal de tu sector <span className="optional">opcional</span>
                <textarea
                  autoFocus
                  value={datos.necesidad}
                  maxLength={500}
                  placeholder="Ejemplo: la vía a la vereda está en mal estado"
                  onChange={(e) => setDatos({ ...datos, necesidad: e.target.value })}
                />
              </label>
              <button type="button" className="choice-button" onClick={() => { setDatos({ ...datos, necesidad: '' }); avanzar(); }}>
                Prefiero no decirla ahora
              </button>
            </>
          )}

          {paso === 'zona' && (
            <>
              <button type="button" className="choice-button" onClick={() => elegirZona(datos.territorioId, datos.territorioNombre)}>
                Donde vivo ({nombrePropio(datos.territorioNombre)})
              </button>
              <label>
                O busca otra vereda o barrio de {nombrePropio(datos.municipioNombre)}
                <input placeholder="Escribe el nombre" onChange={(e) => void buscarZona(e.target.value)} />
              </label>
              <div className="choice-list">
                {zonaResultados.map((t) => (
                  <button type="button" key={t.id} onClick={() => elegirZona(String(t.id), t.nombre)}>
                    {nombrePropio(t.nombre)}
                  </button>
                ))}
              </div>
            </>
          )}

          {paso === 'meta' && (
            <>
              <div className="choice-list">
                {METAS.map((m) => (
                  <button type="button" key={m} className={datos.metaPropuesta === m ? 'selected' : ''} onClick={() => setDatos({ ...datos, metaPropuesta: m })}>
                    {m === '200' ? 'Más de 100' : m}
                  </button>
                ))}
              </div>
              <label>
                Otro número <span className="optional">opcional</span>
                <input inputMode="numeric" value={datos.metaPropuesta} onChange={(e) => setDatos({ ...datos, metaPropuesta: e.target.value.replace(/\D/g, '').slice(0, 5) })} />
              </label>
              <button type="button" className="choice-button" onClick={() => { setDatos({ ...datos, metaPropuesta: '' }); avanzar(); }}>
                Aún no sé
              </button>
            </>
          )}

          {paso === 'organizacion' && (
            <div className="choice-list">
              {ORGANIZACIONES.map((o) => (
                <button
                  type="button"
                  key={o}
                  className={datos.organizacion === o ? 'selected' : ''}
                  onClick={() => {
                    setDatos({ ...datos, organizacion: o });
                    avanzar();
                  }}
                >
                  {o}
                </button>
              ))}
            </div>
          )}

          {paso === 'autorizacion' && (
            <div className="policy-step">
              <details>
                <summary>Leer política de tratamiento de datos</summary>
                <p>{politica.data?.texto}</p>
                <Link to="/privacidad" target="_blank" rel="noopener">
                  Ver la política completa y el responsable
                </Link>
              </details>
              <label className="checkbox-label">
                <input type="checkbox" checked={aceptaPolitica} onChange={(e) => setAceptaPolitica(e.target.checked)} required />
                Autorizo el tratamiento de mis datos para la organización de la campaña
              </label>
              <label className="checkbox-label">
                <input type="checkbox" checked={datos.aceptaComunicaciones} onChange={(e) => setDatos({ ...datos, aceptaComunicaciones: e.target.checked })} />
                Acepto recibir información de la campaña
              </label>
            </div>
          )}

          {paso === 'resumen' && (
            <div className="summary-step">
              <h2>Revisa tus respuestas</h2>
              <dl className="summary-list">
                <div>
                  <dt>Nombre</dt>
                  <dd>
                    {datos.nombres} {datos.apellidos}
                    <button type="button" className="link-button" onClick={() => ir(pasos.indexOf('nombre'))}>
                      Editar
                    </button>
                  </dd>
                </div>
                <div>
                  <dt>Cédula</dt>
                  <dd>
                    {datos.documento}
                    <button type="button" className="link-button" onClick={() => ir(pasos.indexOf('cedula'))}>
                      Editar
                    </button>
                  </dd>
                </div>
                <div>
                  <dt>Celular</dt>
                  <dd>
                    {datos.telefono || 'No informado'}
                    <button type="button" className="link-button" onClick={() => ir(pasos.indexOf('celular'))}>
                      Editar
                    </button>
                  </dd>
                </div>
                <div>
                  <dt>Municipio</dt>
                  <dd>
                    {nombrePropio(datos.municipioNombre)}
                    <button type="button" className="link-button" onClick={() => ir(pasos.indexOf('municipio'))}>
                      Editar
                    </button>
                  </dd>
                </div>
                <div>
                  <dt>Vereda o barrio</dt>
                  <dd>
                    {veredaEsDistinta ? nombrePropio(datos.territorioNombre) : 'A nivel de municipio (no se encontró una más específica)'}
                    <button type="button" className="link-button" onClick={() => ir(pasos.indexOf('vereda'))}>
                      Editar
                    </button>
                  </dd>
                </div>
                <div>
                  <dt>Puesto de votación</dt>
                  <dd>
                    {datos.puestoNombre ? nombrePropio(datos.puestoNombre) : 'No informado'}
                    <button type="button" className="link-button" onClick={() => ir(pasos.indexOf('puesto'))}>
                      Editar
                    </button>
                  </dd>
                </div>
                <div>
                  <dt>Necesidad del sector</dt>
                  <dd>
                    {datos.necesidad.trim() || 'No informada'}
                    <button type="button" className="link-button" onClick={() => ir(pasos.indexOf('necesidad'))}>
                      Editar
                    </button>
                  </dd>
                </div>
                {esLider && (
                  <>
                    <div>
                      <dt>Zona de trabajo como {rolInvitado}</dt>
                      <dd>
                        {textoZona}
                        <button type="button" className="link-button" onClick={() => ir(pasos.indexOf('zona'))}>
                          Editar
                        </button>
                      </dd>
                    </div>
                    <div>
                      <dt>Personas que puede sumar</dt>
                      <dd>
                        {textoMeta}
                        <button type="button" className="link-button" onClick={() => ir(pasos.indexOf('meta'))}>
                          Editar
                        </button>
                      </dd>
                    </div>
                    <div>
                      <dt>Organización</dt>
                      <dd>
                        {datos.organizacion || 'No informada'}
                        <button type="button" className="link-button" onClick={() => ir(pasos.indexOf('organizacion'))}>
                          Editar
                        </button>
                      </dd>
                    </div>
                  </>
                )}
                <div>
                  <dt>Comunicaciones de la campaña</dt>
                  <dd>
                    {datos.aceptaComunicaciones ? 'Acepta recibirlas' : 'No desea recibirlas'}
                    <button type="button" className="link-button" onClick={() => ir(pasos.indexOf('autorizacion'))}>
                      Editar
                    </button>
                  </dd>
                </div>
              </dl>
              <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
                {ubicacion ? (
                  <span style={{ fontSize: 13, color: 'var(--texto-2)' }}>
                    Ubicación compartida.{' '}
                    <button type="button" className="link-button" onClick={() => setUbicacion(null)}>
                      Quitar
                    </button>
                  </span>
                ) : (
                  <button type="button" className="choice-button" style={{ justifySelf: 'start' }} disabled={estadoUbicacion === 'buscando'} onClick={compartirUbicacion}>
                    {estadoUbicacion === 'buscando' ? 'Obteniendo ubicación…' : 'Compartir mi ubicación (opcional)'}
                  </button>
                )}
                {estadoUbicacion === 'error' && <small style={{ color: 'var(--texto-3)' }}>No fue posible obtener la ubicación. Puedes enviar el registro sin ella.</small>}
                {configuracion.data?.captchaSiteKey && <Captcha siteKey={configuracion.data.captchaSiteKey} onToken={setCaptcha} />}
              </div>
            </div>
          )}

          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}

          <div className="chat-actions">
            {step > 0 && (
              <button type="button" className="back-link" onClick={atras}>
                Atrás
              </button>
            )}
            <button className="primary-button" disabled={cargando}>
              {cargando ? 'Enviando...' : step === ULTIMO_STEP ? (esLider ? 'Enviar registro y solicitud' : 'Enviar registro') : 'Continuar'}
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
