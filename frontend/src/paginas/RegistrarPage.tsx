import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api, ApiError } from '../api/cliente';
import { Cargando, ErrorEstado } from '../componentes/Estados';
import { Icono } from '../componentes/Icono';
import { useCatalogoRegistro, normalizar } from '../offline/catalogo';
import { agregarPendiente, descartarPendiente, esErrorDeConexion, type CuerpoRegistro } from '../offline/cola';
import { usePendientes } from '../offline/usePendientes';
import { useSesion } from '../sesion/SesionContext';
import { nombrePropio } from '../util/nombres';

type Zona = { id: number; tipo: string; nombre: string };

const TIPOS: Record<string, string> = { VEREDA: 'Vereda', BARRIO: 'Barrio', COMUNA: 'Comuna', CORREGIMIENTO: 'Corregimiento', CENTRO_POBLADO: 'Centro poblado' };

const inicial = {
  codigoLink: '',
  nombres: '',
  apellidos: '',
  documento: '',
  telefono: '',
  municipioId: '',
  puestoId: '',
  necesidad: '',
  autoriza: false,
  aceptaComunicaciones: false,
};

type Resultado = { tipo: 'REGISTRADO' | 'DUPLICADO' | 'GUARDADO'; nombre: string };

const fechaHora = (iso: string) => new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });

/** Registro asistido: lo usan digitadores, líderes y coordinadores cuando la
 * persona no puede registrarse desde su celular. Funciona sin conexión: el
 * registro queda cifrado en el celular y se envía cuando vuelve la señal. */
export function RegistrarPage() {
  const { usuario } = useSesion();
  const { catalogo, cargando, sinConexion, error: errorCatalogo } = useCatalogoRegistro(usuario?.id);
  const { pendientes, enviando, enviar, ultimoResultado, enLinea } = usePendientes(usuario?.id);
  const [form, setForm] = useState(inicial);
  const [zona, setZona] = useState<Zona | null>(null);
  const [busqueda, setBusqueda] = useState('');
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  const lideres = catalogo?.lideres ?? [];
  const municipio = catalogo?.municipios.find((m) => String(m.id) === form.municipioId);
  const sugerencias = useMemo(() => {
    const texto = normalizar(busqueda);
    if (!municipio || texto.length < 3 || zona) return [];
    return municipio.zonas.filter((z) => normalizar(z.nombre).includes(texto)).slice(0, 12);
  }, [municipio, busqueda, zona]);

  // Si solo hay un líder posible (p. ej. un líder registrando por sí mismo), queda elegido.
  useEffect(() => {
    const unico = lideres.length === 1 ? lideres[0] : undefined;
    if (unico && !form.codigoLink) setForm((f) => ({ ...f, codigoLink: unico.codigo_link }));
  }, [lideres, form.codigoLink]);

  const cambiar = (campo: keyof typeof inicial, valor: string | boolean) => setForm((f) => ({ ...f, [campo]: valor }));

  async function enviarRegistro(e: FormEvent) {
    e.preventDefault();
    if (!catalogo || !usuario) return;
    setError('');
    if (!form.codigoLink) {
      setError('Elige el líder que refiere a la persona.');
      return;
    }
    if (!form.autoriza) {
      setError('Sin la autorización de la persona no se puede registrar.');
      return;
    }
    const nombre = nombrePropio(`${form.nombres} ${form.apellidos}`);
    const cuerpo: CuerpoRegistro = {
      codigoLink: form.codigoLink,
      nombres: form.nombres.trim(),
      apellidos: form.apellidos.trim(),
      documento: form.documento,
      telefono: form.telefono || undefined,
      territorioId: zona ? zona.id : Number(form.municipioId),
      puestoId: form.puestoId ? Number(form.puestoId) : undefined,
      necesidad: form.necesidad.trim() || undefined,
      finalidades: ['ORGANIZACION_CAMPANA', ...(form.aceptaComunicaciones ? ['COMUNICACIONES'] : [])],
      politicaVersion: catalogo.politica.version,
      aceptaPolitica: true,
      canal: 'FORMULARIO_WEB',
      // Hora en que la persona dio sus datos y su autorización (aunque se envíe después).
      capturadoEn: new Date().toISOString(),
    };
    const guardarEnCelular = async () => {
      await agregarPendiente(usuario.id, cuerpo);
      setResultado({ tipo: 'GUARDADO', nombre });
    };
    setGuardando(true);
    try {
      if (!navigator.onLine) {
        await guardarEnCelular();
        return;
      }
      await api.registroInterno(cuerpo);
      setResultado({ tipo: 'REGISTRADO', nombre });
    } catch (causa) {
      if (causa instanceof ApiError && causa.status === 409) setResultado({ tipo: 'DUPLICADO', nombre });
      else if (esErrorDeConexion(causa)) await guardarEnCelular();
      else setError(causa instanceof Error ? causa.message : 'No fue posible registrar a la persona.');
    } finally {
      setGuardando(false);
    }
  }

  function otraPersona() {
    // Se conservan el líder y el municipio: normalmente se registra a varias personas seguidas del mismo sector.
    setForm({ ...inicial, codigoLink: form.codigoLink, municipioId: form.municipioId });
    setZona(null);
    setBusqueda('');
    setResultado(null);
    window.scrollTo({ top: 0 });
  }

  if (errorCatalogo) return <main className="page-content"><ErrorEstado mensaje={`${errorCatalogo} Para registrar sin conexión, abre esta pantalla una vez con señal.`} /></main>;

  return (
    <main className="page-content registrar-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Captura asistida</p>
          <h1>Registrar simpatizante</h1>
          <p className="dashboard-subtitle">Usa este formulario cuando la persona no pueda registrarse desde su celular. Funciona también sin señal.</p>
        </div>
      </div>

      {(!enLinea || sinConexion) && (
        <div className="aviso-conexion" role="status">
          <Icono nombre="info" tamano={18} />
          <span>
            <strong>Sin conexión.</strong> Puedes seguir registrando: cada registro queda guardado y cifrado en este celular y se envía solo cuando vuelva la señal.
            {catalogo && ` Datos del formulario actualizados el ${fechaHora(catalogo.actualizado)}.`}
          </span>
        </div>
      )}

      <PanelPendientes pendientes={pendientes} enviando={enviando} enLinea={enLinea} onEnviar={() => void enviar()} ultimoResultado={ultimoResultado} />

      {cargando && <Cargando />}

      {resultado && (
        <div className={`registration-result ${resultado.tipo === 'DUPLICADO' ? 'duplicate' : ''} ${resultado.tipo === 'GUARDADO' ? 'guardado' : ''}`} role="status">
          <strong style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Icono nombre={resultado.tipo === 'DUPLICADO' ? 'alerta' : resultado.tipo === 'GUARDADO' ? 'candado' : 'check'} tamano={18} />
            {resultado.tipo === 'DUPLICADO'
              ? 'Esta cédula ya estaba registrada'
              : resultado.tipo === 'GUARDADO'
                ? `${resultado.nombre} quedó guardado en este celular`
                : `${resultado.nombre} quedó registrado`}
          </strong>
          <span>
            {resultado.tipo === 'DUPLICADO'
              ? 'No se creó un registro nuevo. El intento quedó anotado como posible duplicado para que el equipo de calidad lo revise.'
              : resultado.tipo === 'GUARDADO'
                ? 'Se enviará automáticamente cuando haya señal, con la fecha y hora de hoy como hora de la autorización.'
                : 'La autorización de datos quedó guardada con la fecha, la hora y el canal.'}
          </span>
          <button type="button" className="primary-button" onClick={otraPersona}>
            Registrar otra persona
          </button>
        </div>
      )}

      {!resultado && catalogo && (
        <form className="dashboard-block registrar-form" onSubmit={enviarRegistro}>
          <h2>Líder que refiere</h2>
          {lideres.length === 0 ? (
            <div className="form-error">No tienes líderes disponibles para atribuir el registro. Pide a la coordinación que te asigne un territorio.</div>
          ) : (
            <label>
              Líder
              <select value={form.codigoLink} onChange={(e) => cambiar('codigoLink', e.target.value)} required>
                <option value="">Selecciona el líder</option>
                {lideres.map((l) => (
                  <option key={l.miembro_id} value={l.codigo_link}>
                    {nombrePropio(l.nombre)}
                    {l.municipio ? ` · ${nombrePropio(l.municipio)}` : ''}
                  </option>
                ))}
              </select>
            </label>
          )}

          <h2>Datos de la persona</h2>
          <div className="form-columns">
            <label>
              Nombres
              <input value={form.nombres} onChange={(e) => cambiar('nombres', e.target.value)} minLength={2} maxLength={80} required autoComplete="off" />
            </label>
            <label>
              Apellidos
              <input value={form.apellidos} onChange={(e) => cambiar('apellidos', e.target.value)} minLength={2} maxLength={80} required autoComplete="off" />
            </label>
            <label>
              Cédula
              <input inputMode="numeric" pattern="[0-9]{5,10}" title="Entre 5 y 10 dígitos, sin puntos" value={form.documento} onChange={(e) => cambiar('documento', e.target.value.replace(/\D/g, ''))} required />
            </label>
            <label>
              Celular <span className="optional">opcional</span>
              <input inputMode="tel" pattern="3[0-9]{9}" title="10 dígitos, empieza por 3" value={form.telefono} onChange={(e) => cambiar('telefono', e.target.value.replace(/\D/g, ''))} />
            </label>
          </div>

          <h2>Dónde vive y dónde vota</h2>
          <div className="form-columns">
            <label>
              Municipio
              <select
                value={form.municipioId}
                onChange={(e) => {
                  setForm((f) => ({ ...f, municipioId: e.target.value, puestoId: '' }));
                  setZona(null);
                  setBusqueda('');
                }}
                required
              >
                <option value="">Selecciona uno</option>
                {catalogo.municipios.map((m) => (
                  <option key={m.id} value={m.id}>
                    {nombrePropio(m.nombre)}
                  </option>
                ))}
              </select>
            </label>
            <div>
              {zona ? (
                <label>
                  Barrio o vereda
                  <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input value={`${nombrePropio(zona.nombre)} (${TIPOS[zona.tipo] ?? zona.tipo})`} readOnly />
                    <button type="button" className="link-button" onClick={() => { setZona(null); setBusqueda(''); }}>
                      Cambiar
                    </button>
                  </span>
                </label>
              ) : (
                <label>
                  Barrio o vereda <span className="optional">escribe al menos 3 letras</span>
                  <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} disabled={!form.municipioId} placeholder={form.municipioId ? 'Buscar…' : 'Primero elige el municipio'} autoComplete="off" />
                </label>
              )}
              {!zona && sugerencias.length > 0 && (
                <div className="choice-list" style={{ marginTop: 8 }}>
                  {sugerencias.map((s) => (
                    <button type="button" key={s.id} onClick={() => setZona(s)}>
                      {nombrePropio(s.nombre)} · {TIPOS[s.tipo] ?? s.tipo}
                    </button>
                  ))}
                </div>
              )}
              {!zona && form.municipioId && (
                <small style={{ color: 'var(--texto-3)', fontSize: 12.5 }}>Si no aparece, se registra a nivel de municipio.</small>
              )}
            </div>
          </div>
          <label>
            Puesto de votación
            <select value={form.puestoId} onChange={(e) => cambiar('puestoId', e.target.value)} disabled={!municipio}>
              <option value="">{municipio ? 'No sabe / lo consulta después' : 'Primero elige el municipio'}</option>
              {municipio?.puestos.map((p) => (
                <option key={p.id} value={p.id}>
                  {nombrePropio(p.nombre)}
                </option>
              ))}
            </select>
          </label>

          <label>
            Necesidad principal del sector <span className="optional">opcional</span>
            <textarea value={form.necesidad} onChange={(e) => cambiar('necesidad', e.target.value)} maxLength={500} placeholder="Ejemplo: la vía a la vereda está en mal estado" />
          </label>

          <h2>Autorización de datos</h2>
          <details className="policy-step">
            <summary>Leer la política de tratamiento de datos</summary>
            <p>{catalogo.politica.texto}</p>
          </details>
          <label className="checkbox-label">
            <input type="checkbox" checked={form.autoriza} onChange={(e) => cambiar('autoriza', e.target.checked)} required />
            La persona autorizó el tratamiento de sus datos (Ley 1581 de 2012)
          </label>
          <label className="checkbox-label">
            <input type="checkbox" checked={form.aceptaComunicaciones} onChange={(e) => cambiar('aceptaComunicaciones', e.target.checked)} />
            Acepta recibir información de la campaña
          </label>

          {error && (
            <div className="form-error" role="alert">
              <Icono nombre="alerta" tamano={17} />
              {error}
            </div>
          )}
          <div className="form-actions">
            <button className="primary-button" disabled={guardando || lideres.length === 0}>
              {guardando ? 'Registrando…' : enLinea ? 'Registrar persona' : 'Guardar en el celular'}
            </button>
          </div>
        </form>
      )}
    </main>
  );
}

function PanelPendientes({
  pendientes,
  enviando,
  enLinea,
  onEnviar,
  ultimoResultado,
}: {
  pendientes: { id: string; creadoEn: string; nombre: string; error?: string }[];
  enviando: boolean;
  enLinea: boolean;
  onEnviar: () => void;
  ultimoResultado: { enviados: number; duplicados: number; requiereSesion: boolean } | null;
}) {
  const [abierto, setAbierto] = useState(false);
  if (pendientes.length === 0) {
    if (ultimoResultado && ultimoResultado.enviados + ultimoResultado.duplicados > 0) {
      return (
        <div className="form-success" role="status" style={{ marginBottom: 16 }}>
          <Icono nombre="check" tamano={17} /> Se enviaron {ultimoResultado.enviados} registros guardados en el celular
          {ultimoResultado.duplicados > 0 ? ` (${ultimoResultado.duplicados} ya estaban registrados)` : ''}.
        </div>
      );
    }
    return null;
  }
  const conError = pendientes.filter((p) => p.error).length;
  return (
    <section className="dashboard-block pendientes">
      <div className="block-heading">
        <div>
          <h2>
            {pendientes.length} {pendientes.length === 1 ? 'registro guardado' : 'registros guardados'} en este celular
          </h2>
          <small style={{ color: 'var(--texto-3)' }}>
            {enviando ? 'Enviando…' : enLinea ? 'Se envían automáticamente.' : 'Se enviarán cuando vuelva la señal.'}
            {ultimoResultado?.requiereSesion && ' Tu sesión venció: vuelve a iniciar sesión para enviarlos.'}
            {conError > 0 && ` ${conError} necesita${conError === 1 ? '' : 'n'} revisión.`}
          </small>
        </div>
        <div className="form-actions">
          <button type="button" className="secondary-button" onClick={() => setAbierto(!abierto)}>
            {abierto ? 'Ocultar' : 'Ver lista'}
          </button>
          <button type="button" className="primary-button" disabled={!enLinea || enviando} onClick={onEnviar}>
            {enviando ? 'Enviando…' : 'Enviar ahora'}
          </button>
        </div>
      </div>
      {abierto && (
        <ul className="lista-pendientes">
          {pendientes.map((p) => (
            <li key={p.id}>
              <span>
                <strong>{nombrePropio(p.nombre)}</strong>
                <small>Capturado el {fechaHora(p.creadoEn)}</small>
                {p.error && <small className="texto-error">No se pudo enviar: {p.error}</small>}
              </span>
              {p.error && (
                <button
                  type="button"
                  className="link-button danger"
                  onClick={() => {
                    if (window.confirm(`¿Descartar el registro de ${nombrePropio(p.nombre)}? Se borrará de este celular.`)) void descartarPendiente(p.id);
                  }}
                >
                  Descartar
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
