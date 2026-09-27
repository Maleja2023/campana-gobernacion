import { useState, type FormEvent } from 'react';
import { useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/cliente';
import { Cargando, ErrorEstado } from '../componentes/Estados';
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
  aceptaComunicaciones: boolean;
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
  aceptaComunicaciones: false,
};

// 0 nombres, 1 documento, 2 celular, 3 municipio, 4 vereda/barrio,
// 5 puesto de votación, 6 autorización, 7 resumen.
const ULTIMO_STEP = 7;

export function RegistroPublicoPage() {
  const { codigo = '' } = useParams();
  const link = useQuery({ queryKey: ['registro-link', codigo], queryFn: () => api.validarLink(codigo), enabled: Boolean(codigo) });
  const municipios = useQuery({ queryKey: ['registro-municipios'], queryFn: api.municipios });
  const politica = useQuery({ queryKey: ['registro-politica'], queryFn: api.politicaRegistro });

  const [step, setStep] = useState(0);
  const [datos, setDatos] = useState(inicial);
  const [veredaResultados, setVeredaResultados] = useState<{ id: number; nombre: string }[]>([]);
  const [aceptaPolitica, setAceptaPolitica] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);

  const puestos = useQuery({
    queryKey: ['registro-puestos', datos.municipioId],
    queryFn: () => api.puestos(Number(datos.municipioId)),
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
  const lider = link.data.lider ? nombrePropio(link.data.lider) : 'tu líder';

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

  function elegirPuesto(id: string) {
    const nombre = puestos.data?.find((p) => String(p.id) === id)?.nombre ?? '';
    setDatos({ ...datos, puestoId: id, puestoNombre: nombre });
  }

  async function enviar(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (!politica.data) return;
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
        finalidades: ['ORGANIZACION_CAMPANA', ...(datos.aceptaComunicaciones ? ['COMUNICACIONES'] : [])],
        politicaVersion: politica.data.version,
        aceptaPolitica: true,
        canal: 'CHATBOT_WEB',
      });
      void respuesta;
      setEnviado(true);
    } catch (cause) {
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
          <div className="bubble system">Hola, {lider} te invitó a hacer parte de la campaña. Te haré unas preguntas cortas.</div>
          {step >= 1 && <div className="bubble system">¿Cuáles son tus nombres y apellidos?</div>}
          {step >= 1 && (
            <div className="bubble person">
              {datos.nombres} {datos.apellidos}
            </div>
          )}
          {step >= 2 && <div className="bubble system">¿Cuál es tu número de cédula?</div>}
          {step >= 2 && <div className="bubble person">{datos.documento}</div>}
          {step >= 3 && <div className="bubble system">¿Cuál es tu celular? Es opcional.</div>}
          {step >= 3 && <div className="bubble person">{datos.telefono || 'Prefiero no darlo'}</div>}
          {step >= 4 && <div className="bubble system">¿En qué municipio vives?</div>}
          {step >= 4 && <div className="bubble person">{datos.municipioNombre}</div>}
          {step >= 5 && <div className="bubble system">¿En qué vereda o barrio?</div>}
          {step >= 5 && <div className="bubble person">{veredaEsDistinta ? datos.territorioNombre : 'No la encontró en la búsqueda'}</div>}
          {step >= 6 && <div className="bubble system">¿En qué puesto de votación estás inscrito?</div>}
          {step >= 6 && <div className="bubble person">{datos.puestoNombre || 'No sé, lo consulto después'}</div>}
        </div>

        <form onSubmit={step === ULTIMO_STEP ? enviar : (e) => { e.preventDefault(); avanzar(); }} className="chat-form">
          {step === 0 && (
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

          {step === 1 && (
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

          {step === 2 && (
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

          {step === 3 && (
            <label>
              Municipio
              <select autoFocus value={datos.municipioId} onChange={(e) => elegirMunicipio(e.target.value)} required>
                <option value="">Selecciona uno</option>
                {municipios.data?.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nombre}
                  </option>
                ))}
              </select>
            </label>
          )}

          {step === 4 && (
            <>
              <label>
                Busca tu vereda o barrio
                <input autoFocus placeholder="Escribe el nombre" onChange={(e) => void buscarVereda(e.target.value)} />
              </label>
              <div className="choice-list">
                {veredaResultados.map((t) => (
                  <button type="button" key={t.id} onClick={() => elegirVereda(String(t.id), t.nombre)}>
                    {t.nombre}
                  </button>
                ))}
                <button type="button" className="choice-button" onClick={avanzar}>
                  Mi vereda o barrio no aparece
                </button>
              </div>
            </>
          )}

          {step === 5 && (
            <label>
              Puesto de votación
              <select autoFocus value={datos.puestoId} onChange={(e) => elegirPuesto(e.target.value)}>
                <option value="">No sé / lo consulto después</option>
                {puestos.data?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
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

          {step === 6 && (
            <div className="policy-step">
              <details>
                <summary>Leer política de tratamiento de datos</summary>
                <p>{politica.data?.texto}</p>
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

          {step === 7 && (
            <div className="summary-step">
              <h2>Revisa tus respuestas</h2>
              <dl className="summary-list">
                <div>
                  <dt>Nombre</dt>
                  <dd>
                    {datos.nombres} {datos.apellidos}
                    <button type="button" className="link-button" onClick={() => ir(0)}>
                      Editar
                    </button>
                  </dd>
                </div>
                <div>
                  <dt>Cédula</dt>
                  <dd>
                    {datos.documento}
                    <button type="button" className="link-button" onClick={() => ir(1)}>
                      Editar
                    </button>
                  </dd>
                </div>
                <div>
                  <dt>Celular</dt>
                  <dd>
                    {datos.telefono || 'No informado'}
                    <button type="button" className="link-button" onClick={() => ir(2)}>
                      Editar
                    </button>
                  </dd>
                </div>
                <div>
                  <dt>Municipio</dt>
                  <dd>
                    {datos.municipioNombre}
                    <button type="button" className="link-button" onClick={() => ir(3)}>
                      Editar
                    </button>
                  </dd>
                </div>
                <div>
                  <dt>Vereda o barrio</dt>
                  <dd>
                    {veredaEsDistinta ? datos.territorioNombre : 'A nivel de municipio (no se encontró una más específica)'}
                    <button type="button" className="link-button" onClick={() => ir(4)}>
                      Editar
                    </button>
                  </dd>
                </div>
                <div>
                  <dt>Puesto de votación</dt>
                  <dd>
                    {datos.puestoNombre || 'No informado'}
                    <button type="button" className="link-button" onClick={() => ir(5)}>
                      Editar
                    </button>
                  </dd>
                </div>
                <div>
                  <dt>Comunicaciones de la campaña</dt>
                  <dd>
                    {datos.aceptaComunicaciones ? 'Acepta recibirlas' : 'No desea recibirlas'}
                    <button type="button" className="link-button" onClick={() => ir(6)}>
                      Editar
                    </button>
                  </dd>
                </div>
              </dl>
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
              {cargando ? 'Enviando...' : step === ULTIMO_STEP ? 'Enviar registro' : 'Continuar'}
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
