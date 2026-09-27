import { useEffect, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../api/cliente';
import { Cargando, ErrorEstado } from '../componentes/Estados';
import { Icono } from '../componentes/Icono';
import { nombrePropio } from '../util/nombres';

type Zona = { id: number; tipo: string; nombre: string; municipio: string | null };

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

type Resultado = { tipo: 'REGISTRADO' | 'DUPLICADO'; nombre: string };

/** Registro asistido: lo usan digitadores, líderes y coordinadores cuando la
 * persona no puede registrarse desde su celular. */
export function RegistrarPage() {
  const municipios = useQuery({ queryKey: ['municipios'], queryFn: api.municipios });
  const politica = useQuery({ queryKey: ['registro-politica'], queryFn: api.politicaRegistro });
  const lideres = useQuery({ queryKey: ['lideres-registro'], queryFn: api.lideresRegistro });
  const [form, setForm] = useState(inicial);
  const [zona, setZona] = useState<Zona | null>(null);
  const [busqueda, setBusqueda] = useState('');
  const [sugerencias, setSugerencias] = useState<Zona[]>([]);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  const puestos = useQuery({
    queryKey: ['puestos-catalogo', form.municipioId],
    queryFn: () => api.puestosCatalogo(Number(form.municipioId)),
    enabled: Boolean(form.municipioId),
  });

  // Si solo hay un líder posible (p. ej. un líder registrando por sí mismo), queda elegido.
  useEffect(() => {
    const unico = lideres.data?.length === 1 ? lideres.data[0] : undefined;
    if (unico && !form.codigoLink) setForm((f) => ({ ...f, codigoLink: unico.codigo_link }));
  }, [lideres.data, form.codigoLink]);

  useEffect(() => {
    const texto = busqueda.trim();
    if (texto.length < 3 || zona || !form.municipioId) {
      setSugerencias([]);
      return;
    }
    let vigente = true;
    const id = setTimeout(() => {
      api
        .buscarTerritorio(texto, Number(form.municipioId))
        .then((r) => vigente && setSugerencias(r.filter((z) => z.tipo !== 'MUNICIPIO')))
        .catch(() => vigente && setSugerencias([]));
    }, 250);
    return () => {
      vigente = false;
      clearTimeout(id);
    };
  }, [busqueda, zona, form.municipioId]);

  const cambiar = (campo: keyof typeof inicial, valor: string | boolean) => setForm((f) => ({ ...f, [campo]: valor }));

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!politica.data) return;
    setError('');
    if (!form.codigoLink) {
      setError('Elige el líder que refiere a la persona.');
      return;
    }
    if (!form.autoriza) {
      setError('Sin la autorización de la persona no se puede registrar.');
      return;
    }
    setGuardando(true);
    const nombre = nombrePropio(`${form.nombres} ${form.apellidos}`);
    try {
      await api.registroInterno({
        codigoLink: form.codigoLink,
        nombres: form.nombres,
        apellidos: form.apellidos,
        documento: form.documento,
        telefono: form.telefono || undefined,
        territorioId: zona ? zona.id : Number(form.municipioId),
        puestoId: form.puestoId ? Number(form.puestoId) : undefined,
        necesidad: form.necesidad.trim() || undefined,
        finalidades: ['ORGANIZACION_CAMPANA', ...(form.aceptaComunicaciones ? ['COMUNICACIONES'] : [])],
        politicaVersion: politica.data.version,
        aceptaPolitica: true,
        canal: 'FORMULARIO_WEB',
      });
      setResultado({ tipo: 'REGISTRADO', nombre });
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) setResultado({ tipo: 'DUPLICADO', nombre });
      else setError(cause instanceof Error ? cause.message : 'No fue posible registrar a la persona.');
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

  if (municipios.isError) return <main className="page-content"><ErrorEstado mensaje={municipios.error.message} /></main>;

  return (
    <main className="page-content registrar-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Captura asistida</p>
          <h1>Registrar simpatizante</h1>
          <p className="dashboard-subtitle">Usa este formulario cuando la persona no pueda registrarse desde su celular.</p>
        </div>
      </div>

      {(municipios.isPending || lideres.isPending) && <Cargando />}

      {resultado && (
        <div className={`registration-result ${resultado.tipo === 'DUPLICADO' ? 'duplicate' : ''}`} role="status">
          <strong style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Icono nombre={resultado.tipo === 'DUPLICADO' ? 'alerta' : 'check'} tamano={18} />
            {resultado.tipo === 'DUPLICADO' ? 'Esta cédula ya estaba registrada' : `${resultado.nombre} quedó registrado`}
          </strong>
          <span>
            {resultado.tipo === 'DUPLICADO'
              ? 'No se creó un registro nuevo. El intento quedó anotado como posible duplicado para que el equipo de calidad lo revise.'
              : 'La autorización de datos quedó guardada con la fecha, la hora y el canal.'}
          </span>
          <button type="button" className="primary-button" onClick={otraPersona}>
            Registrar otra persona
          </button>
        </div>
      )}

      {!resultado && lideres.data && (
        <form className="dashboard-block registrar-form" onSubmit={enviar}>
          <h2>Líder que refiere</h2>
          {lideres.data.length === 0 ? (
            <div className="form-error">No tienes líderes disponibles para atribuir el registro. Pide a la coordinación que te asigne un territorio.</div>
          ) : (
            <label>
              Líder
              <select value={form.codigoLink} onChange={(e) => cambiar('codigoLink', e.target.value)} required>
                <option value="">Selecciona el líder</option>
                {lideres.data.map((l) => (
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
                {municipios.data?.map((m) => (
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
            <select value={form.puestoId} onChange={(e) => cambiar('puestoId', e.target.value)} disabled={!form.municipioId}>
              <option value="">{form.municipioId ? 'No sabe / lo consulta después' : 'Primero elige el municipio'}</option>
              {puestos.data?.map((p) => (
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
            <p>{politica.data?.texto}</p>
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
            <button className="primary-button" disabled={guardando || lideres.data.length === 0}>
              {guardando ? 'Registrando…' : 'Registrar persona'}
            </button>
          </div>
        </form>
      )}
    </main>
  );
}
