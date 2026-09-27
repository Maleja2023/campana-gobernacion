import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api, type EstadoSolicitudTitular } from '../api/cliente';
import { Captcha } from '../componentes/Captcha';
import { Cargando } from '../componentes/Estados';
import { Icono } from '../componentes/Icono';

const fecha = (v: string) => new Date(v.length === 10 ? `${v}T12:00:00` : v).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' });

function Encabezado({ titulo, subtitulo }: { titulo: string; subtitulo: string }) {
  return (
    <header className="publica-encabezado">
      <span className="brand-mark">
        <Icono nombre="escudo" tamano={19} />
      </span>
      <div>
        <p className="eyebrow">Protección de datos personales · Ley 1581 de 2012</p>
        <h1>{titulo}</h1>
        <p>{subtitulo}</p>
      </div>
    </header>
  );
}

function Responsable() {
  const r = useQuery({ queryKey: ['responsable-datos'], queryFn: api.responsableDatos });
  if (!r.data) return null;
  return (
    <section className="publica-bloque">
      <h2>Responsable del tratamiento</h2>
      <p>
        <strong>{r.data.nombre}</strong>
        {r.data.correo && (
          <>
            {' '}
            · <a href={`mailto:${r.data.correo}`}>{r.data.correo}</a>
          </>
        )}
        {r.data.telefono && <> · {r.data.telefono}</>}
      </p>
    </section>
  );
}

/** Política de tratamiento de datos vigente, pública (sin iniciar sesión). */
export function PrivacidadPage() {
  const politica = useQuery({ queryKey: ['registro-politica'], queryFn: api.politicaRegistro });
  return (
    <main className="publica-page">
      <article className="publica-card">
        <Encabezado titulo="Política de tratamiento de datos" subtitulo="Cómo recogemos, usamos y protegemos tus datos personales." />
        <Responsable />
        {politica.isPending && <Cargando texto="Cargando la política..." />}
        {politica.data && (
          <>
            <section className="publica-bloque">
              <h2>Política vigente (versión {politica.data.version})</h2>
              <div className="politica-texto">
                {politica.data.texto.split(/\n+/).map((parrafo, i) => (
                  <p key={i}>{parrafo}</p>
                ))}
              </div>
            </section>
            <section className="publica-bloque">
              <h2>¿Para qué usamos tus datos?</h2>
              <ul>
                {politica.data.finalidades.map((f) => (
                  <li key={f.codigo}>{f.descripcion}</li>
                ))}
              </ul>
              <p className="helper">Solo usamos tus datos para las finalidades que autorizaste al registrarte.</p>
            </section>
          </>
        )}
        <section className="publica-bloque">
          <h2>Cómo los protegemos</h2>
          <ul>
            <li>Tu cédula y tu celular se guardan cifrados: ni siquiera quien administra la base de datos puede leerlos directamente.</li>
            <li>Cada persona del equipo solo ve los datos de su territorio o de su red, y cada consulta, cambio o exporte queda registrado.</li>
            <li>El acceso del equipo exige contraseña y, para los cargos de dirección, un segundo factor.</li>
            <li>Al terminar la campaña los datos se eliminan según el plan de cierre.</li>
          </ul>
        </section>
        <section className="publica-bloque">
          <h2>Tus derechos</h2>
          <p>
            Puedes conocer, actualizar y rectificar tus datos, pedir que los eliminemos, revocar tu autorización y dejar de recibir mensajes en cualquier
            momento. Respondemos consultas en 10 días hábiles y reclamos en 15.
          </p>
          <Link className="primary-button" to="/mis-datos">
            Ejercer mis derechos
          </Link>
        </section>
      </article>
    </main>
  );
}

const TIPOS: { codigo: string; nombre: string; ayuda: string }[] = [
  { codigo: 'CONSULTA', nombre: 'Conocer mis datos', ayuda: 'Te enviamos qué datos tenemos de ti y para qué los usamos.' },
  { codigo: 'ACTUALIZACION', nombre: 'Actualizar o corregir', ayuda: 'Cuéntanos qué dato está mal y cuál es el correcto.' },
  { codigo: 'SUPRESION', nombre: 'Eliminar mis datos', ayuda: 'Borramos tus datos de la campaña.' },
  { codigo: 'REVOCATORIA', nombre: 'Revocar mi autorización', ayuda: 'Dejamos de usar tus datos y de enviarte mensajes.' },
];

/** Canal público para que el titular ejerza sus derechos y deje de recibir mensajes. */
export function MisDatosPage() {
  const configuracion = useQuery({ queryKey: ['registro-configuracion'], queryFn: api.configuracionRegistro });
  const siteKey = configuracion.data?.captchaSiteKey ?? null;
  const [seccion, setSeccion] = useState<'solicitud' | 'estado' | 'baja'>('solicitud');

  return (
    <main className="publica-page">
      <article className="publica-card">
        <Encabezado titulo="Mis datos" subtitulo="Consulta, corrige o elimina tus datos, o deja de recibir mensajes de la campaña." />
        <nav className="agenda-tabs" aria-label="Qué quieres hacer">
          <button type="button" className={seccion === 'solicitud' ? 'active' : ''} onClick={() => setSeccion('solicitud')}>
            Hacer una solicitud
          </button>
          <button type="button" className={seccion === 'estado' ? 'active' : ''} onClick={() => setSeccion('estado')}>
            Ver el estado
          </button>
          <button type="button" className={seccion === 'baja' ? 'active' : ''} onClick={() => setSeccion('baja')}>
            No recibir mensajes
          </button>
        </nav>
        {seccion === 'solicitud' && <NuevaSolicitud siteKey={siteKey} />}
        {seccion === 'estado' && <VerEstado />}
        {seccion === 'baja' && <NoRecibirMensajes siteKey={siteKey} />}
        <p className="helper publica-pie">
          <Link to="/privacidad">Política de tratamiento de datos</Link>
        </p>
      </article>
    </main>
  );
}

function NuevaSolicitud({ siteKey }: { siteKey: string | null }) {
  const [tipo, setTipo] = useState('CONSULTA');
  const [documento, setDocumento] = useState('');
  const [contacto, setContacto] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');
  const [resultado, setResultado] = useState<{ radicado: string; fechaLimite: string }>();

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (siteKey && !captcha) return setError('Confirma que no eres un robot.');
    setEnviando(true);
    try {
      setResultado(await api.radicarSolicitudTitular({ tipo, documento, contacto: contacto.trim(), descripcion: descripcion.trim(), captcha: captcha ?? undefined }));
    } catch (causa) {
      setCaptcha(null);
      setError(causa instanceof Error ? causa.message : 'No fue posible radicar la solicitud.');
    } finally {
      setEnviando(false);
    }
  }

  if (resultado) {
    return (
      <div className="publica-exito">
        <Icono nombre="check" tamano={22} />
        <div>
          <strong>Tu solicitud quedó radicada</strong>
          <p>
            Número de radicado: <span className="codigo">{resultado.radicado}</span>. Guárdalo: con él y tu cédula puedes ver el estado.
          </p>
          <p>Te responderemos a más tardar el {fecha(resultado.fechaLimite)}, al contacto que nos diste.</p>
        </div>
      </div>
    );
  }

  const ayuda = TIPOS.find((t) => t.codigo === tipo)?.ayuda;
  return (
    <form className="publica-form" onSubmit={enviar}>
      <fieldset className="choice-list">
        <legend>¿Qué quieres hacer?</legend>
        {TIPOS.map((t) => (
          <button key={t.codigo} type="button" className={tipo === t.codigo ? 'selected' : ''} onClick={() => setTipo(t.codigo)}>
            {t.nombre}
          </button>
        ))}
      </fieldset>
      {ayuda && <p className="helper">{ayuda}</p>}
      <label>
        Número de cédula
        <input inputMode="numeric" pattern="[0-9]{5,10}" value={documento} onChange={(e) => setDocumento(e.target.value.replace(/\D/g, ''))} required />
      </label>
      <label>
        ¿Dónde te respondemos? (correo o celular)
        <input value={contacto} onChange={(e) => setContacto(e.target.value)} minLength={5} maxLength={120} required />
      </label>
      <label>
        Cuéntanos tu solicitud
        <textarea value={descripcion} onChange={(e) => setDescripcion(e.target.value)} minLength={10} maxLength={2000} rows={4} required />
      </label>
      <p className="helper">Para proteger tus datos, antes de responder confirmaremos que eres el titular de la cédula.</p>
      {siteKey && <Captcha siteKey={siteKey} onToken={setCaptcha} />}
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      <button className="primary-button" disabled={enviando}>
        {enviando ? 'Enviando...' : 'Radicar solicitud'}
      </button>
    </form>
  );
}

const ESTADO: Record<EstadoSolicitudTitular['estado'], string> = {
  RECIBIDA: 'Recibida',
  EN_TRAMITE: 'En trámite',
  RESPONDIDA: 'Respondida',
  RECHAZADA: 'Rechazada',
};

function VerEstado() {
  const [radicado, setRadicado] = useState('');
  const [documento, setDocumento] = useState('');
  const [error, setError] = useState('');
  const [estado, setEstado] = useState<EstadoSolicitudTitular>();

  async function consultar(e: FormEvent) {
    e.preventDefault();
    setError('');
    setEstado(undefined);
    try {
      setEstado(await api.estadoSolicitudTitular({ radicado: radicado.trim(), documento }));
    } catch (causa) {
      setError(causa instanceof Error ? causa.message : 'No fue posible consultar.');
    }
  }

  return (
    <form className="publica-form" onSubmit={consultar}>
      <label>
        Número de radicado
        <input placeholder="T-2026-00012" value={radicado} onChange={(e) => setRadicado(e.target.value.toUpperCase())} required />
      </label>
      <label>
        Número de cédula
        <input inputMode="numeric" pattern="[0-9]{5,10}" value={documento} onChange={(e) => setDocumento(e.target.value.replace(/\D/g, ''))} required />
      </label>
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      <button className="primary-button">Consultar</button>
      {estado && (
        <div className="publica-estado">
          <p>
            <strong>{estado.tipo}</strong> · radicada el {fecha(estado.recibida_en)} · <span className="estado-pill">{ESTADO[estado.estado]}</span>
          </p>
          {estado.respondida_en ? (
            <p>
              Respondida el {fecha(estado.respondida_en)}: {estado.respuesta}
            </p>
          ) : (
            <p>Te responderemos a más tardar el {fecha(estado.fecha_limite)}.</p>
          )}
        </div>
      )}
    </form>
  );
}

function NoRecibirMensajes({ siteKey }: { siteKey: string | null }) {
  const [documento, setDocumento] = useState('');
  const [canal, setCanal] = useState('');
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState('');
  const [error, setError] = useState('');

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (siteKey && !captcha) return setError('Confirma que no eres un robot.');
    try {
      setMensaje((await api.bajaMensajes({ documento, canal: canal || undefined, captcha: captcha ?? undefined })).mensaje);
    } catch (causa) {
      setCaptcha(null);
      setError(causa instanceof Error ? causa.message : 'No fue posible procesar la solicitud.');
    }
  }

  if (mensaje) {
    return (
      <div className="publica-exito">
        <Icono nombre="check" tamano={22} />
        <div>
          <strong>Solicitud recibida</strong>
          <p>{mensaje}</p>
        </div>
      </div>
    );
  }
  return (
    <form className="publica-form" onSubmit={enviar}>
      <p>Aplica de inmediato. Seguirás registrado en la campaña; si quieres que eliminemos tus datos, usa "Hacer una solicitud".</p>
      <label>
        Número de cédula
        <input inputMode="numeric" pattern="[0-9]{5,10}" value={documento} onChange={(e) => setDocumento(e.target.value.replace(/\D/g, ''))} required />
      </label>
      <label>
        ¿Qué mensajes no quieres recibir?
        <select value={canal} onChange={(e) => setCanal(e.target.value)}>
          <option value="">Ninguno (SMS, correo y Telegram)</option>
          <option value="SMS">Solo SMS</option>
          <option value="EMAIL">Solo correo</option>
          <option value="TELEGRAM">Solo Telegram</option>
        </select>
      </label>
      {siteKey && <Captcha siteKey={siteKey} onToken={setCaptcha} />}
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      <button className="primary-button">No recibir más mensajes</button>
    </form>
  );
}
