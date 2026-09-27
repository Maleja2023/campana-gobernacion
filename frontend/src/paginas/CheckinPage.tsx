import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/cliente';
import { Captcha } from '../componentes/Captcha';
import { Cargando } from '../componentes/Estados';
import { Icono } from '../componentes/Icono';
import { nombrePropio } from '../util/nombres';

const hora = (v: string) => new Date(v).toLocaleString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' });

/** Página pública del QR de un evento: /e/<código>. */
export function CheckinPage() {
  const { codigo = '' } = useParams();
  const evento = useQuery({ queryKey: ['evento-publico', codigo], queryFn: () => api.eventoPublico(codigo), retry: false });
  const [enviado, setEnviado] = useState<string>();

  return (
    <main className="publica-page">
      <article className="publica-card checkin-card">
        <header className="publica-encabezado">
          <span className="brand-mark">
            <Icono nombre="calendario" tamano={19} />
          </span>
          <div>
            <p className="eyebrow">Registro de asistencia</p>
            {evento.data ? (
              <>
                <h1>{evento.data.nombre}</h1>
                <p>
                  {evento.data.tipo} · {nombrePropio(evento.data.lugar.split(' > ').slice(1).join(', ') || evento.data.lugar)} · {hora(evento.data.inicia_en)}
                </p>
              </>
            ) : (
              <h1>Evento de la campaña</h1>
            )}
          </div>
        </header>

        {evento.isPending && <Cargando texto="Buscando el evento..." />}
        {evento.isError && (
          <div className="form-error" role="alert">
            Este código de evento no existe o el evento fue cancelado. Revisa el QR o pregunta al equipo organizador.
          </div>
        )}
        {evento.data && !evento.data.abierto && !enviado && (
          <div className="publica-estado">
            <strong>El registro de asistencia no está abierto en este momento.</strong>
            <p>
              Se abre el {hora(evento.data.abre_en)} y se cierra el {hora(evento.data.cierra_en)}.
            </p>
          </div>
        )}
        {enviado && (
          <div className="publica-exito">
            <Icono nombre="check" tamano={22} />
            <div>
              <strong>{enviado}</strong>
              <p>Puedes cerrar esta página.</p>
            </div>
          </div>
        )}
        {evento.data?.abierto && !enviado && <FormularioCheckin codigo={codigo} municipioId={evento.data.municipio_id} onListo={setEnviado} />}

        <p className="helper publica-pie">
          <Link to="/privacidad">Política de tratamiento de datos</Link> · <Link to="/mis-datos">Mis datos</Link>
        </p>
      </article>
    </main>
  );
}

function FormularioCheckin({ codigo, municipioId, onListo }: { codigo: string; municipioId: number; onListo: (mensaje: string) => void }) {
  const politica = useQuery({ queryKey: ['registro-politica'], queryFn: api.politicaRegistro });
  const configuracion = useQuery({ queryKey: ['registro-configuracion'], queryFn: api.configuracionRegistro });
  const municipios = useQuery({ queryKey: ['registro-municipios'], queryFn: api.municipios });
  const siteKey = configuracion.data?.captchaSiteKey ?? null;

  const [datos, setDatos] = useState({ documento: '', nombres: '', apellidos: '', telefono: '', municipio: String(municipioId) });
  const [zona, setZona] = useState<{ id: number; nombre: string }>();
  const [busqueda, setBusqueda] = useState('');
  const [resultados, setResultados] = useState<{ id: number; nombre: string; tipo: string }[]>([]);
  const [acepta, setAcepta] = useState(false);
  const [comunicaciones, setComunicaciones] = useState(false);
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');

  async function buscar(texto: string) {
    setBusqueda(texto);
    setResultados(texto.trim().length >= 3 ? await api.buscarTerritorio(texto.trim(), Number(datos.municipio)).catch(() => []) : []);
  }

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!politica.data) return;
    if (siteKey && !captcha) return setError('Confirma que no eres un robot.');
    setEnviando(true);
    try {
      const r = await api.checkinEvento(codigo, {
        documento: datos.documento,
        nombres: datos.nombres.trim(),
        apellidos: datos.apellidos.trim(),
        telefono: datos.telefono || undefined,
        territorioId: zona?.id ?? Number(datos.municipio),
        finalidades: ['ORGANIZACION_CAMPANA', 'EVENTOS', ...(comunicaciones ? ['COMUNICACIONES'] : [])],
        politicaVersion: politica.data.version,
        aceptaPolitica: acepta,
        captcha: captcha ?? undefined,
      });
      onListo(r.mensaje);
    } catch (causa) {
      setCaptcha(null);
      setError(causa instanceof Error ? causa.message : 'No fue posible registrar tu asistencia.');
    } finally {
      setEnviando(false);
    }
  }

  const campo = (k: keyof typeof datos) => (e: { target: { value: string } }) => setDatos({ ...datos, [k]: e.target.value });

  return (
    <form className="publica-form" onSubmit={enviar}>
      <label>
        Número de cédula
        <input inputMode="numeric" pattern="[0-9]{5,10}" value={datos.documento} onChange={(e) => setDatos({ ...datos, documento: e.target.value.replace(/\D/g, '') })} required autoFocus />
      </label>
      <div className="form-columns">
        <label>
          Nombres
          <input value={datos.nombres} onChange={campo('nombres')} minLength={2} maxLength={80} autoComplete="given-name" required />
        </label>
        <label>
          Apellidos
          <input value={datos.apellidos} onChange={campo('apellidos')} minLength={2} maxLength={80} autoComplete="family-name" required />
        </label>
      </div>
      <label>
        Celular (opcional)
        <input inputMode="tel" pattern="3[0-9]{9}" value={datos.telefono} onChange={(e) => setDatos({ ...datos, telefono: e.target.value.replace(/\D/g, '') })} placeholder="3001234567" />
      </label>
      <label>
        ¿En qué municipio vives?
        <select
          value={datos.municipio}
          onChange={(e) => {
            setDatos({ ...datos, municipio: e.target.value });
            setZona(undefined);
            setResultados([]);
            setBusqueda('');
          }}
          required
        >
          {municipios.data?.map((m) => (
            <option key={m.id} value={m.id}>
              {nombrePropio(m.nombre)}
            </option>
          ))}
        </select>
      </label>
      {zona ? (
        <p className="helper">
          Vereda o barrio: <strong>{nombrePropio(zona.nombre)}</strong>{' '}
          <button type="button" className="link-button" onClick={() => setZona(undefined)}>
            Cambiar
          </button>
        </p>
      ) : (
        <label>
          Vereda o barrio (opcional)
          <input value={busqueda} onChange={(e) => void buscar(e.target.value)} placeholder="Escribe al menos 3 letras" />
        </label>
      )}
      {!zona && resultados.length > 0 && (
        <div className="choice-list">
          {resultados.slice(0, 8).map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => {
                setZona({ id: r.id, nombre: r.nombre });
                setResultados([]);
              }}
            >
              {nombrePropio(r.nombre)}
            </button>
          ))}
        </div>
      )}

      <details className="checkin-politica">
        <summary>Leer la política de tratamiento de datos</summary>
        <p>{politica.data?.texto}</p>
        <Link to="/privacidad" target="_blank" rel="noopener">
          Ver la política completa
        </Link>
      </details>
      <label className="checkbox-label">
        <input type="checkbox" checked={acepta} onChange={(e) => setAcepta(e.target.checked)} required />
        Autorizo el tratamiento de mis datos para registrar mi asistencia y organizar la campaña. Si es mi primer registro, quedo inscrito como
        simpatizante.
      </label>
      <label className="checkbox-label">
        <input type="checkbox" checked={comunicaciones} onChange={(e) => setComunicaciones(e.target.checked)} />
        Acepto recibir información de la campaña
      </label>
      {siteKey && <Captcha siteKey={siteKey} onToken={setCaptcha} />}
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      <button className="primary-button" disabled={enviando || !politica.data}>
        {enviando ? 'Registrando...' : 'Registrar mi asistencia'}
      </button>
    </form>
  );
}
