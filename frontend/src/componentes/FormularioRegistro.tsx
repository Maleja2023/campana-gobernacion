import { useEffect, useState, type FormEvent } from 'react';
import { api, ErrorApi } from '../api/cliente';
import type { Politica, ResultadoBusqueda } from '../api/tipos';
import { nombrePropio, TIPOS_ZONA } from '../util/formato';
import { useDatos } from '../util/useDatos';
import { useMunicipios } from '../util/useMunicipios';
import { Icono } from './Icono';

const OBLIGATORIA = 'ORGANIZACION_CAMPANA';

/** Selector de residencia: municipio + vereda/comuna/corregimiento de la cartografía oficial. */
function SelectorResidencia({ valor, onCambio }: { valor: ResultadoBusqueda | null; onCambio: (t: ResultadoBusqueda | null) => void }) {
  const municipios = useMunicipios();
  const [municipio, setMunicipio] = useState('');
  const [texto, setTexto] = useState('');
  const [sugerencias, setSugerencias] = useState<ResultadoBusqueda[]>([]);

  useEffect(() => {
    if (texto.trim().length < 3 || valor) {
      setSugerencias([]);
      return;
    }
    let vigente = true;
    const t = setTimeout(() => {
      api
        .get<ResultadoBusqueda[]>('/territorio/buscar', { q: texto.trim(), padre: municipio || undefined })
        .then((r) => vigente && setSugerencias(r.filter((x) => x.tipo !== 'MUNICIPIO')))
        .catch(() => vigente && setSugerencias([]));
    }, 250);
    return () => {
      vigente = false;
      clearTimeout(t);
    };
  }, [texto, municipio, valor]);

  const nombreMunicipio = municipios.datos?.find((m) => String(m.id) === municipio)?.nombre;

  return (
    <div className="fila-2">
      <label className="campo">
        <span>Municipio</span>
        <select className="entrada" value={municipio} required onChange={(e) => { setMunicipio(e.target.value); setTexto(''); onCambio(null); }}>
          <option value="">Seleccione…</option>
          {municipios.datos?.map((m) => (
            <option key={m.id} value={m.id}>{nombrePropio(m.nombre)}</option>
          ))}
        </select>
      </label>
      <div className="campo">
        <label htmlFor="zona-residencia" style={{ fontSize: 13, fontWeight: 600, color: 'var(--texto-2)' }}>Vereda, barrio o comuna</label>
        {valor ? (
          <div className="entrada" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {nombrePropio(valor.nombre)} <small style={{ color: 'var(--texto-3)' }}>{TIPOS_ZONA[valor.tipo] ?? valor.tipo}</small>
            </span>
            <button type="button" className="boton-icono" style={{ width: 26, height: 26 }} aria-label="Cambiar zona" onClick={() => { onCambio(null); setTexto(''); }}>
              <Icono nombre="cerrar" tamano={14} />
            </button>
          </div>
        ) : (
          <>
            <div className="entrada-con-icono">
              <Icono nombre="buscar" tamano={16} />
              <input id="zona-residencia" className="entrada" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={municipio ? 'Escriba al menos 3 letras' : 'Primero elija el municipio'} disabled={!municipio} autoComplete="off" />
            </div>
            {sugerencias.length > 0 && (
              <ul className="lista-sugerencias" role="listbox">
                {sugerencias.map((s) => (
                  <li key={s.id}>
                    <button type="button" onClick={() => onCambio(s)}>
                      {nombrePropio(s.nombre)}
                      <small>{TIPOS_ZONA[s.tipo] ?? s.tipo}{s.municipio ? ` · ${nombrePropio(s.municipio)}` : ''}</small>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {municipio && texto.trim().length >= 3 && sugerencias.length === 0 && (
              <small>
                ¿No aparece?{' '}
                <button type="button" className="enlace-boton" onClick={() => onCambio({ id: Number(municipio), tipo: 'MUNICIPIO', nombre: nombreMunicipio ?? '', municipio: null, similitud: 1 })}>
                  Registrar solo el municipio
                </button>
              </small>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function FormularioRegistro({ modo, codigoLink, alTerminar }: { modo: 'publico' | 'interno'; codigoLink?: string; alTerminar?: (mensaje: string) => void }) {
  const politica = useDatos(() => api.get<Politica>('/registro/politica'), []);
  const [nombres, setNombres] = useState('');
  const [apellidos, setApellidos] = useState('');
  const [documento, setDocumento] = useState('');
  const [telefono, setTelefono] = useState('');
  const [zona, setZona] = useState<ResultadoBusqueda | null>(null);
  const [necesidad, setNecesidad] = useState('');
  const [finalidades, setFinalidades] = useState<string[]>([OBLIGATORIA]);
  const [acepta, setAcepta] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!zona) {
      setError('Seleccione la vereda, barrio o comuna donde vive.');
      return;
    }
    if (!politica.datos) return;
    setEnviando(true);
    setError(null);
    const cuerpo = {
      codigoLink,
      documento: documento.replace(/\D/g, ''),
      nombres,
      apellidos,
      telefono: telefono.replace(/\D/g, '') || undefined,
      territorioId: zona.id,
      necesidad: necesidad.trim() || undefined,
      finalidades,
      politicaVersion: politica.datos.version,
      aceptaPolitica: acepta,
      canal: 'FORMULARIO_WEB',
    };
    try {
      const r = await api.post<{ mensaje: string }>(modo === 'publico' ? '/registro' : '/simpatizantes', cuerpo);
      alTerminar?.(r.mensaje);
      setNombres('');
      setApellidos('');
      setDocumento('');
      setTelefono('');
      setZona(null);
      setNecesidad('');
      setAcepta(false);
    } catch (err) {
      setError(err instanceof ErrorApi && err.estado === 409 ? 'Esta persona ya está registrada en la campaña.' : err instanceof Error ? err.message : 'No fue posible registrar.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={enviar} noValidate={false}>
      {error && (
        <div className="aviso aviso-critico" role="alert">
          <Icono nombre="alerta" /> {error}
        </div>
      )}
      <div className="fila-2">
        <label className="campo">
          <span>Nombres</span>
          <input className="entrada" value={nombres} onChange={(e) => setNombres(e.target.value)} required minLength={2} maxLength={80} autoComplete="given-name" />
        </label>
        <label className="campo">
          <span>Apellidos</span>
          <input className="entrada" value={apellidos} onChange={(e) => setApellidos(e.target.value)} required minLength={2} maxLength={80} autoComplete="family-name" />
        </label>
      </div>
      <div className="fila-2">
        <label className="campo">
          <span>Cédula de ciudadanía</span>
          <input className="entrada num" value={documento} onChange={(e) => setDocumento(e.target.value)} required inputMode="numeric" pattern="\d{5,10}" title="Entre 5 y 10 dígitos, sin puntos" />
        </label>
        <label className="campo">
          <span>Celular <small>(opcional)</small></span>
          <input className="entrada num" value={telefono} onChange={(e) => setTelefono(e.target.value)} inputMode="tel" pattern="3\d{9}" title="10 dígitos, empieza por 3" autoComplete="tel" />
        </label>
      </div>

      <SelectorResidencia valor={zona} onCambio={setZona} />

      <label className="campo">
        <span>¿Cuál es la principal necesidad de su comunidad? <small>(opcional)</small></span>
        <textarea className="entrada" value={necesidad} onChange={(e) => setNecesidad(e.target.value)} maxLength={500} placeholder="Ejemplo: la vía a la vereda está en mal estado" />
      </label>

      {politica.error && <div className="aviso aviso-critico"><Icono nombre="alerta" /> {politica.error}</div>}
      {politica.datos && (
        <div className="campo">
          <span>Tratamiento de datos personales</span>
          <div className="politica-texto">{politica.datos.texto}</div>
          {politica.datos.finalidades.map((f) => (
            <label key={f.codigo} className="casilla">
              <input
                type="checkbox"
                checked={finalidades.includes(f.codigo)}
                disabled={f.codigo === OBLIGATORIA}
                onChange={(e) => setFinalidades((fs) => (e.target.checked ? [...fs, f.codigo] : fs.filter((x) => x !== f.codigo)))}
              />
              <span>
                {f.descripcion}
                {f.codigo === OBLIGATORIA && <small style={{ color: 'var(--texto-3)' }}> (necesaria para el registro)</small>}
              </span>
            </label>
          ))}
          <label className="casilla" style={{ color: 'var(--texto)', fontWeight: 500 }}>
            <input type="checkbox" checked={acepta} onChange={(e) => setAcepta(e.target.checked)} required />
            <span>{modo === 'publico' ? 'Autorizo' : 'La persona autoriza'} el tratamiento de mis datos personales según la política anterior (Ley 1581 de 2012).</span>
          </label>
        </div>
      )}

      <button className="boton boton-primario" type="submit" disabled={enviando || !acepta || !politica.datos} style={{ height: 44 }}>
        {enviando ? 'Registrando…' : modo === 'publico' ? 'Enviar mi registro' : 'Registrar simpatizante'}
      </button>
    </form>
  );
}
