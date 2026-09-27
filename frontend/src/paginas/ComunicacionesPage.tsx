import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type CanalMensaje, type EnvioMensaje, type PlantillaMensaje } from '../api/cliente';
import { Cargando, ErrorEstado } from '../componentes/Estados';
import { useSesion } from '../sesion/SesionContext';
import { nombrePropio } from '../util/nombres';

type Tab = 'avisos' | 'plantillas' | 'envios';
const CANALES: Record<CanalMensaje, string> = { SMS: 'SMS', EMAIL: 'Correo', TELEGRAM: 'Telegram (canal público)' };
const ESTADOS_ENVIO: Record<EnvioMensaje['estado'], string> = {
  BORRADOR: 'Borrador',
  PROGRAMADO: 'Programado',
  EN_CURSO: 'Enviando',
  TERMINADO: 'Terminado',
  CANCELADO: 'Cancelado',
};
const fecha = (v: string) => new Date(v).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
const mensajeError = (e: unknown, porDefecto: string) => (e instanceof Error ? e.message : porDefecto);

export function ComunicacionesPage() {
  const { tienePermiso } = useSesion();
  const puedeAvisar = tienePermiso('MIEMBRO_GESTIONAR') || tienePermiso('COMUNICACION_ENVIAR');
  const verPlantillas = tienePermiso('COMUNICACION_APROBAR') || tienePermiso('COMUNICACION_ENVIAR');
  const enviar = tienePermiso('COMUNICACION_ENVIAR');
  const tabs = ([
    ['avisos', 'Avisos al equipo', puedeAvisar],
    ['plantillas', 'Mensajes a votantes: plantillas', verPlantillas],
    ['envios', 'Envíos', enviar],
  ] as [Tab, string, boolean][]).filter(([, , ver]) => ver);
  const [tab, setTab] = useState<Tab>(tabs[0]?.[0] ?? 'avisos');

  return (
    <main className="page-content">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Comunicaciones</p>
          <h1>Comunicaciones</h1>
          <p className="dashboard-subtitle">
            Avisos internos al equipo y mensajes a votantes. A los votantes solo les llega a quien lo autorizó, y quien pide la baja queda fuera de
            inmediato.
          </p>
        </div>
      </div>
      <nav className="agenda-tabs" aria-label="Secciones de comunicaciones">
        {tabs.map(([clave, etiqueta]) => (
          <button key={clave} type="button" className={tab === clave ? 'active' : ''} onClick={() => setTab(clave)}>
            {etiqueta}
          </button>
        ))}
      </nav>
      {tab === 'avisos' && puedeAvisar && <AvisoEquipo />}
      {tab === 'plantillas' && verPlantillas && <Plantillas />}
      {tab === 'envios' && enviar && <Envios />}
    </main>
  );
}

function AvisoEquipo() {
  const [titulo, setTitulo] = useState('');
  const [cuerpo, setCuerpo] = useState('');
  const [cargos, setCargos] = useState<string[]>([]);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string }>();
  const [enviando, setEnviando] = useState(false);
  const alternar = (c: string) => setCargos(cargos.includes(c) ? cargos.filter((x) => x !== c) : [...cargos, c]);

  async function enviarAviso(e: FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setAviso(undefined);
    try {
      const r = await api.avisoEquipo({ titulo, cuerpo, cargos });
      setAviso({ ok: true, texto: r.enviados ? `Aviso enviado a ${r.enviados} personas de tu equipo.` : 'Nadie de tu equipo con esos cargos tiene usuario en la plataforma.' });
      if (r.enviados) {
        setTitulo('');
        setCuerpo('');
      }
    } catch (causa) {
      setAviso({ ok: false, texto: mensajeError(causa, 'No se pudo enviar el aviso.') });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section className="dashboard-block">
      <div className="block-heading">
        <div>
          <h2>Aviso al equipo</h2>
          <p>Les llega a los miembros de tu red que tienen usuario, en la campana de notificaciones de la plataforma.</p>
        </div>
      </div>
      <form className="publica-form comunicaciones-form" onSubmit={enviarAviso}>
        <label>
          Título
          <input value={titulo} onChange={(e) => setTitulo(e.target.value)} minLength={3} maxLength={160} required placeholder="Reunión de líderes el sábado" />
        </label>
        <label>
          Mensaje
          <textarea value={cuerpo} onChange={(e) => setCuerpo(e.target.value)} minLength={3} maxLength={2000} rows={4} required />
        </label>
        <fieldset className="choice-list">
          <legend>¿A quiénes? (sin marcar = a toda tu red)</legend>
          {[
            ['COORDINADOR', 'Coordinadores'],
            ['LIDER', 'Líderes'],
            ['SUBLIDER', 'Sublíderes'],
          ].map(([c, etiqueta]) => (
            <button key={c} type="button" className={cargos.includes(c) ? 'selected' : ''} onClick={() => alternar(c)}>
              {etiqueta}
            </button>
          ))}
        </fieldset>
        {aviso && <p className={aviso.ok ? 'form-success' : 'form-error'}>{aviso.texto}</p>}
        <button className="primary-button" disabled={enviando}>
          {enviando ? 'Enviando...' : 'Enviar aviso'}
        </button>
      </form>
    </section>
  );
}

function Plantillas() {
  const cache = useQueryClient();
  const { usuario, tienePermiso } = useSesion();
  const puedeCrear = tienePermiso('COMUNICACION_ENVIAR');
  const puedeAprobar = tienePermiso('COMUNICACION_APROBAR');
  const config = useQuery({ queryKey: ['comunicaciones', 'configuracion'], queryFn: api.configuracionMensajes });
  const plantillas = useQuery({ queryKey: ['comunicaciones', 'plantillas'], queryFn: api.plantillasMensaje });
  const [nueva, setNueva] = useState(false);
  const [error, setError] = useState('');
  const refrescar = () => void cache.invalidateQueries({ queryKey: ['comunicaciones'] });

  async function aprobar(p: PlantillaMensaje) {
    setError('');
    try {
      await api.aprobarPlantillaMensaje(p.id);
      refrescar();
    } catch (causa) {
      setError(mensajeError(causa, 'No se pudo aprobar.'));
    }
  }

  return (
    <section className="dashboard-block">
      <div className="block-heading">
        <div>
          <h2>Plantillas de mensajes</h2>
          <p>Cada plantilla la aprueba una persona distinta a quien la escribió (el candidato o el gerente). Si se edita, vuelve a necesitar aprobación.</p>
        </div>
        {puedeCrear && !nueva && (
          <button type="button" className="primary-button" onClick={() => setNueva(true)}>
            Nueva plantilla
          </button>
        )}
      </div>
      {config.data && <CanalesConfigurados canales={config.data.canales} />}
      {nueva && config.data && (
        <NuevaPlantilla
          largoSms={config.data.largoSms}
          onListo={() => {
            setNueva(false);
            refrescar();
          }}
          onCancelar={() => setNueva(false)}
        />
      )}
      {error && <p className="form-error">{error}</p>}
      {plantillas.isPending && <Cargando />}
      {plantillas.isError && <ErrorEstado mensaje={plantillas.error.message} />}
      {plantillas.data?.length === 0 && <div className="empty-inline">Todavía no hay plantillas.</div>}
      <ul className="solicitudes-lider">
        {plantillas.data?.map((p) => (
          <li key={p.id}>
            <div className="solicitud-datos">
              <strong>
                {p.nombre} <span className="estado-pill">{CANALES[p.canal_codigo]}</span>{' '}
                <span className={`estado-pill ${p.aprobada_en ? 'estado-bien' : 'estado-aviso'}`}>{p.aprobada_en ? 'Aprobada' : 'Sin aprobar'}</span>
              </strong>
              {p.asunto && <span>Asunto: {p.asunto}</span>}
              <p className="solicitud-texto">{p.contenido}</p>
              <small>
                Escrita por {p.autor ?? '—'}
                {p.aprobada_en && ` · aprobada por ${p.aprobador} el ${fecha(p.aprobada_en)}`}
              </small>
            </div>
            <div className="solicitud-acciones">
              {puedeAprobar && !p.aprobada_en && p.creada_por !== usuario?.id && (
                <button type="button" className="primary-button" onClick={() => void aprobar(p)}>
                  Aprobar
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function CanalesConfigurados({ canales }: { canales: Record<CanalMensaje, boolean> }) {
  const faltan = (Object.keys(canales) as CanalMensaje[]).filter((c) => !canales[c]);
  if (!faltan.length) return null;
  return (
    <p className="helper aviso-canales">
      Sin configurar en el servidor: {faltan.map((c) => CANALES[c]).join(', ')}. Se pueden preparar plantillas, pero no se enviarán hasta que el
      administrador configure el proveedor (ver docs/comunicaciones.md).
    </p>
  );
}

function NuevaPlantilla({ largoSms, onListo, onCancelar }: { largoSms: number; onListo: () => void; onCancelar: () => void }) {
  const [canal, setCanal] = useState<CanalMensaje>('SMS');
  const [nombre, setNombre] = useState('');
  const [asunto, setAsunto] = useState('');
  const [contenido, setContenido] = useState('');
  const [error, setError] = useState('');
  const conTildes = canal === 'SMS' && /[^\x00-\x7F]/.test(contenido);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api.crearPlantillaMensaje({ nombre, canal, asunto: canal === 'EMAIL' ? asunto : undefined, contenido });
      onListo();
    } catch (causa) {
      setError(mensajeError(causa, 'No se pudo guardar la plantilla.'));
    }
  }

  return (
    <form className="publica-form tramite" onSubmit={guardar}>
      <label>
        Nombre interno
        <input value={nombre} onChange={(e) => setNombre(e.target.value)} minLength={3} maxLength={120} required placeholder="Invitación foro Florencia" />
      </label>
      <label>
        Canal
        <select value={canal} onChange={(e) => setCanal(e.target.value as CanalMensaje)}>
          {(Object.keys(CANALES) as CanalMensaje[]).map((c) => (
            <option key={c} value={c}>
              {CANALES[c]}
            </option>
          ))}
        </select>
      </label>
      {canal === 'EMAIL' && (
        <label>
          Asunto
          <input value={asunto} onChange={(e) => setAsunto(e.target.value)} minLength={3} maxLength={160} required />
        </label>
      )}
      <label>
        Mensaje
        <textarea value={contenido} onChange={(e) => setContenido(e.target.value)} rows={canal === 'SMS' ? 3 : 8} minLength={5} maxLength={canal === 'SMS' ? largoSms : 4000} required />
      </label>
      <p className="helper">
        {canal === 'TELEGRAM'
          ? 'Se publica en el canal de Telegram de la campaña: lo ve quien se unió al canal. No lleva datos de nadie.'
          : 'Escribe {nombre} para saludar a cada persona por su nombre. El enlace para dejar de recibir mensajes se agrega solo.'}
        {canal === 'SMS' && ` ${contenido.length}/${largoSms} caracteres.`}
        {conTildes && ' Con tildes o ñ, cada SMS admite menos caracteres y el envío cuesta más.'}
      </p>
      {error && <p className="form-error">{error}</p>}
      <div className="form-actions">
        <button type="button" className="secondary-button" onClick={onCancelar}>
          Cancelar
        </button>
        <button className="primary-button">Guardar para aprobación</button>
      </div>
    </form>
  );
}

function Envios() {
  const cache = useQueryClient();
  const envios = useQuery({ queryKey: ['comunicaciones', 'envios'], queryFn: api.enviosMensaje, refetchInterval: 15_000 });
  const plantillas = useQuery({ queryKey: ['comunicaciones', 'plantillas'], queryFn: api.plantillasMensaje });
  const municipios = useQuery({ queryKey: ['municipios'], queryFn: api.municipios });
  const aprobadas = plantillas.data?.filter((p) => p.aprobada_en) ?? [];
  const [plantillaId, setPlantillaId] = useState('');
  const [territorios, setTerritorios] = useState<number[]>([]);
  const [cuando, setCuando] = useState('');
  const [error, setError] = useState('');
  const plantilla = aprobadas.find((p) => p.id === plantillaId);
  const refrescar = () => void cache.invalidateQueries({ queryKey: ['comunicaciones', 'envios'] });

  async function preparar(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api.prepararEnvio({ plantillaId, territorioIds: territorios, programadoPara: cuando ? new Date(cuando).toISOString() : undefined });
      setPlantillaId('');
      setTerritorios([]);
      setCuando('');
      refrescar();
    } catch (causa) {
      setError(mensajeError(causa, 'No se pudo preparar el envío.'));
    }
  }

  async function estado(id: string, nuevo: 'PROGRAMADO' | 'BORRADOR' | 'CANCELADO') {
    setError('');
    try {
      await api.estadoEnvio(id, nuevo);
      refrescar();
    } catch (causa) {
      setError(mensajeError(causa, 'No se pudo cambiar el envío.'));
    }
  }

  return (
    <section className="dashboard-block">
      <div className="block-heading">
        <div>
          <h2>Preparar un envío</h2>
          <p>
            Primero se prepara (borrador) y se ve a cuántas personas les llegará. Solo cuenta a quien autorizó recibir información y no pidió la baja. Luego
            se programa.
          </p>
        </div>
      </div>
      <form className="publica-form comunicaciones-form" onSubmit={preparar}>
        <label>
          Plantilla aprobada
          <select value={plantillaId} onChange={(e) => setPlantillaId(e.target.value)} required>
            <option value="">{aprobadas.length ? 'Elige una plantilla' : 'No hay plantillas aprobadas'}</option>
            {aprobadas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre} · {CANALES[p.canal_codigo]}
              </option>
            ))}
          </select>
        </label>
        {plantilla && plantilla.canal_codigo !== 'TELEGRAM' && (
          <fieldset className="choice-list">
            <legend>Municipios</legend>
            {municipios.data?.map((m) => (
              <button
                key={m.id}
                type="button"
                className={territorios.includes(m.id) ? 'selected' : ''}
                onClick={() => setTerritorios(territorios.includes(m.id) ? territorios.filter((t) => t !== m.id) : [...territorios, m.id])}
              >
                {nombrePropio(m.nombre)}
              </button>
            ))}
          </fieldset>
        )}
        <label>
          Enviar el (vacío = apenas se programe)
          <input type="datetime-local" value={cuando} onChange={(e) => setCuando(e.target.value)} />
        </label>
        {error && <p className="form-error">{error}</p>}
        <button className="primary-button" disabled={!plantilla || (plantilla.canal_codigo !== 'TELEGRAM' && territorios.length === 0)}>
          Preparar borrador
        </button>
      </form>

      <h2 className="subtitulo-bloque">Envíos</h2>
      {envios.isPending && <Cargando />}
      {envios.isError && <ErrorEstado mensaje={envios.error.message} />}
      {envios.data?.length === 0 && <div className="empty-inline">Todavía no hay envíos.</div>}
      <ul className="solicitudes-lider">
        {envios.data?.map((e) => {
          const destinatarios = Number(e.pendientes) + Number(e.enviados) + Number(e.fallidos);
          return (
            <li key={e.id}>
              <div className="solicitud-datos">
                <strong>
                  {e.plantilla} <span className="estado-pill">{CANALES[e.canal]}</span> <span className="estado-pill">{ESTADOS_ENVIO[e.estado]}</span>
                </strong>
                <span>
                  {e.canal === 'TELEGRAM' ? 'Canal de Telegram' : e.territorios} · para el {fecha(e.programado_para)} · preparado por {e.creado_por}
                </span>
                {e.canal !== 'TELEGRAM' && (
                  <dl>
                    <div>
                      <dt>Destinatarios</dt>
                      <dd>{destinatarios}</dd>
                    </div>
                    <div>
                      <dt>Enviados</dt>
                      <dd>{e.enviados}</dd>
                    </div>
                    <div>
                      <dt>Fallidos</dt>
                      <dd>{e.fallidos}</dd>
                    </div>
                    <div>
                      <dt>Sin autorización o de baja</dt>
                      <dd>{e.omitidos}</dd>
                    </div>
                  </dl>
                )}
                {e.resultado && <small>{e.resultado}</small>}
              </div>
              <div className="solicitud-acciones">
                {e.estado === 'BORRADOR' && (
                  <button type="button" className="primary-button" onClick={() => void estado(e.id, 'PROGRAMADO')}>
                    Programar
                  </button>
                )}
                {e.estado === 'PROGRAMADO' && (
                  <button type="button" className="secondary-button" onClick={() => void estado(e.id, 'BORRADOR')}>
                    Detener
                  </button>
                )}
                {['BORRADOR', 'PROGRAMADO', 'EN_CURSO'].includes(e.estado) && (
                  <button type="button" className="secondary-button boton-peligro" onClick={() => void estado(e.id, 'CANCELADO')}>
                    Cancelar
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
