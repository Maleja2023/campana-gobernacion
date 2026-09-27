import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { api, type MiembroRed, type MiLink } from '../api/cliente';
import { Cargando, ErrorEstado } from '../componentes/Estados';
import { useSesion } from '../sesion/SesionContext';
import { nombrePropio } from '../util/nombres';

type Tab = 'links' | 'estructura' | 'metas';
const CARGOS: { codigo: 'COORDINADOR' | 'LIDER' | 'SUBLIDER'; etiqueta: string }[] = [
  { codigo: 'COORDINADOR', etiqueta: 'Coordinador' },
  { codigo: 'LIDER', etiqueta: 'Líder' },
  { codigo: 'SUBLIDER', etiqueta: 'Sublíder' },
];

function formatFecha(v: string | null) {
  if (!v) return 'Sin registros';
  return new Date(v).toLocaleDateString('es-CO', { year: 'numeric', month: 'short', day: 'numeric' });
}

function palabraSimpatizantes(n: number) {
  return `${n} ${n === 1 ? 'simpatizante' : 'simpatizantes'}`;
}

export function RedPage() {
  const { tienePermiso } = useSesion();
  const puedeGestionarMiembros = tienePermiso('MIEMBRO_GESTIONAR');
  const puedeGestionarMetas = tienePermiso('META_GESTIONAR');
  const [tab, setTab] = useState<Tab>('links');

  return (
    <main className="page-content red-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Estructura de campaña</p>
          <h1>Mi red</h1>
        </div>
      </div>
      <nav className="mode-selector" role="tablist" aria-label="Secciones de mi red">
        <button type="button" role="tab" aria-selected={tab === 'links'} className={tab === 'links' ? 'selected' : ''} onClick={() => setTab('links')}>
          Mis links
        </button>
        <button type="button" role="tab" aria-selected={tab === 'estructura'} className={tab === 'estructura' ? 'selected' : ''} onClick={() => setTab('estructura')}>
          Estructura
        </button>
        {puedeGestionarMetas && (
          <button type="button" role="tab" aria-selected={tab === 'metas'} className={tab === 'metas' ? 'selected' : ''} onClick={() => setTab('metas')}>
            Metas
          </button>
        )}
      </nav>
      {tab === 'links' && <MisLinks />}
      {tab === 'estructura' && <Estructura puedeGestionar={puedeGestionarMiembros} />}
      {tab === 'metas' && puedeGestionarMetas && <Metas />}
    </main>
  );
}

function MisLinks() {
  const cache = useQueryClient();
  const links = useQuery({ queryKey: ['red-links'], queryFn: api.misLinks });
  const [expiraEn, setExpiraEn] = useState('');
  const [creando, setCreando] = useState(false);
  const [error, setError] = useState('');
  const [qrAbierto, setQrAbierto] = useState<string>();
  const [copiado, setCopiado] = useState<string>();

  async function crear(e: FormEvent) {
    e.preventDefault();
    setError('');
    setCreando(true);
    try {
      await api.crearLink(expiraEn ? new Date(expiraEn).toISOString() : undefined);
      setExpiraEn('');
      await cache.invalidateQueries({ queryKey: ['red-links'] });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No fue posible crear el link.');
    } finally {
      setCreando(false);
    }
  }

  async function alternar(link: MiLink) {
    setError('');
    try {
      await api.actualizarLink(link.id, !link.activo);
      await cache.invalidateQueries({ queryKey: ['red-links'] });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No fue posible cambiar el estado del link.');
    }
  }

  async function copiar(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopiado(url);
      setTimeout(() => setCopiado(undefined), 2000);
    } catch {
      setError('No se pudo copiar el enlace: copia manual con Ctrl+C.');
    }
  }

  if (links.isPending) return <Cargando texto="Cargando tus links..." />;
  if (links.isError) return <ErrorEstado mensaje={links.error.message} reintentar={() => void links.refetch()} />;

  return (
    <div className="dashboard-block">
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      <div className="table-wrap">
        <table>
          <caption className="sr-only">Mis links de referido</caption>
          <thead>
            <tr>
              <th>Código</th>
              <th>Simpatizantes</th>
              <th>Vence</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {links.data.map((link) => (
              <tr key={link.id}>
                <td>
                  <strong>{link.codigo}</strong>
                  {link.es_principal && <span className="estado-pill estado-activo">Principal</span>}
                </td>
                <td>{palabraSimpatizantes(link.simpatizantes)}</td>
                <td>{link.expira_en ? formatFecha(link.expira_en) : 'No vence'}</td>
                <td>
                  <span className={`estado-pill ${link.activo ? 'estado-activo' : 'estado-retirado'}`}>{link.activo ? 'Activo' : 'Inactivo'}</span>
                </td>
                <td>
                  <div className="row-actions">
                    <button type="button" className="link-button" onClick={() => void copiar(link.url)}>
                      {copiado === link.url ? 'Copiado' : 'Copiar enlace'}
                    </button>
                    <a
                      className="link-button"
                      href={`https://wa.me/?text=${encodeURIComponent(`Te invito a hacer parte de la campaña. Regístrate aquí: ${link.url}`)}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Compartir por WhatsApp
                    </a>
                    <button type="button" className="link-button" onClick={() => setQrAbierto(qrAbierto === link.url ? undefined : link.url)}>
                      {qrAbierto === link.url ? 'Ocultar QR' : 'Ver QR'}
                    </button>
                    {!link.es_principal && (
                      <button type="button" className="link-button" onClick={() => void alternar(link)}>
                        {link.activo ? 'Desactivar' : 'Activar'}
                      </button>
                    )}
                  </div>
                  {qrAbierto === link.url && <QrDescargable codigo={link.codigo} url={link.url} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form className="filter-row" onSubmit={crear}>
        <label>
          Crear link adicional, vence el <span className="optional">opcional</span>
          <input type="datetime-local" value={expiraEn} onChange={(e) => setExpiraEn(e.target.value)} />
        </label>
        <button type="submit" className="secondary-button" disabled={creando}>
          {creando ? 'Creando...' : 'Crear link'}
        </button>
      </form>
    </div>
  );
}

function QrDescargable({ codigo, url }: { codigo: string; url: string }) {
  const qr = useQuery({ queryKey: ['red-link-qr', url], queryFn: () => QRCode.toDataURL(url, { margin: 1, width: 240 }) });
  if (qr.isPending) return <Cargando texto="Generando código QR..." />;
  if (qr.isError || !qr.data) return <p className="form-error">No fue posible generar el código QR.</p>;
  return (
    <div className="qr-panel">
      <img src={qr.data} alt={`Código QR del link ${codigo}`} width={120} height={120} />
      <a className="secondary-button" href={qr.data} download={`link-${codigo}.png`}>
        Descargar PNG
      </a>
    </div>
  );
}

function Estructura({ puedeGestionar }: { puedeGestionar: boolean }) {
  const cache = useQueryClient();
  const arbol = useQuery({ queryKey: ['red-arbol'], queryFn: api.redArbol });
  const [error, setError] = useState('');
  const [creandoAbierto, setCreandoAbierto] = useState(false);

  async function alternarActivo(m: MiembroRed) {
    setError('');
    try {
      await api.actualizarMiembro(m.miembro_id, { activo: !m.activo });
      await cache.invalidateQueries({ queryKey: ['red-arbol'] });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No fue posible cambiar el estado del miembro.');
    }
  }

  async function cambiarSuperior(m: MiembroRed, superiorId: string) {
    if (!superiorId || superiorId === (m.superior_id ?? '')) return;
    setError('');
    try {
      await api.actualizarMiembro(m.miembro_id, { superiorId });
      await cache.invalidateQueries({ queryKey: ['red-arbol'] });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No fue posible cambiar el superior.');
    }
  }

  if (arbol.isPending) return <Cargando texto="Cargando la estructura..." />;
  if (arbol.isError) return <ErrorEstado mensaje={arbol.error.message} reintentar={() => void arbol.refetch()} />;

  return (
    <div className="dashboard-block">
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      <div className="table-wrap">
        <table>
          <caption className="sr-only">Árbol de la estructura de campaña</caption>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Cargo</th>
              <th>Activos referidos</th>
              <th>Último registro</th>
              <th>Estado</th>
              {puedeGestionar && <th>Acciones</th>}
            </tr>
          </thead>
          <tbody>
            {arbol.data.map((m) => (
              <tr key={m.miembro_id}>
                <td style={{ paddingLeft: `${m.profundidad}rem` }}>{nombrePropio(m.nombre)}</td>
                <td>{m.cargo_codigo}</td>
                <td>{m.activos ?? 0}</td>
                <td>{formatFecha(m.ultimo_registro)}</td>
                <td>
                  <span className={`estado-pill ${m.activo ? 'estado-activo' : 'estado-retirado'}`}>{m.activo ? 'Activo' : 'Inactivo'}</span>
                </td>
                {puedeGestionar && (
                  <td>
                    <div className="row-actions">
                      <button type="button" className="link-button" onClick={() => void alternarActivo(m)}>
                        {m.activo ? 'Desactivar' : 'Activar'}
                      </button>
                      <select
                        aria-label={`Cambiar superior de ${m.nombre}`}
                        value=""
                        onChange={(e) => void cambiarSuperior(m, e.target.value)}
                      >
                        <option value="">Cambiar superior a...</option>
                        {arbol.data
                          .filter((otro) => otro.miembro_id !== m.miembro_id)
                          .map((otro) => (
                            <option key={otro.miembro_id} value={otro.miembro_id}>
                              {nombrePropio(otro.nombre)}
                            </option>
                          ))}
                      </select>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {puedeGestionar && (
        <>
          <button type="button" className="secondary-button" onClick={() => setCreandoAbierto(!creandoAbierto)}>
            {creandoAbierto ? 'Cancelar' : 'Crear miembro'}
          </button>
          {creandoAbierto && (
            <CrearMiembroForm
              miembros={arbol.data}
              onDone={async () => {
                setCreandoAbierto(false);
                await cache.invalidateQueries({ queryKey: ['red-arbol'] });
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

function CrearMiembroForm({ miembros, onDone }: { miembros: MiembroRed[]; onDone: () => void | Promise<void> }) {
  const [documento, setDocumento] = useState('');
  const [nombres, setNombres] = useState('');
  const [apellidos, setApellidos] = useState('');
  const [telefono, setTelefono] = useState('');
  const [cargo, setCargo] = useState<'COORDINADOR' | 'LIDER' | 'SUBLIDER'>('LIDER');
  const [superiorId, setSuperiorId] = useState('');
  const [error, setError] = useState('');
  const [exito, setExito] = useState<{ codigoLink: string; urlLink: string }>();
  const [guardando, setGuardando] = useState(false);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setError('');
    setGuardando(true);
    try {
      const res = await api.crearMiembro({ documento, nombres: nombres.trim(), apellidos: apellidos.trim(), telefono: telefono || undefined, cargo, superiorId });
      setExito({ codigoLink: res.codigoLink, urlLink: res.urlLink });
      await onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No fue posible crear el miembro.');
    } finally {
      setGuardando(false);
    }
  }

  if (exito) {
    return (
      <div className="dashboard-block success-chat">
        <strong>Miembro creado</strong>
        <p>
          Su link principal es <strong>{exito.codigoLink}</strong>: {exito.urlLink}
        </p>
      </div>
    );
  }

  return (
    <form className="dashboard-block visit-form" onSubmit={guardar}>
      <h2>Crear miembro</h2>
      <div className="form-columns">
        <label>
          Nombres
          <input value={nombres} onChange={(e) => setNombres(e.target.value)} minLength={2} required />
        </label>
        <label>
          Apellidos
          <input value={apellidos} onChange={(e) => setApellidos(e.target.value)} minLength={2} required />
        </label>
      </div>
      <label>
        Cédula
        <input inputMode="numeric" pattern="[0-9]{5,10}" value={documento} onChange={(e) => setDocumento(e.target.value.replace(/\D/g, ''))} required />
      </label>
      <label>
        Celular <span className="optional">opcional</span>
        <input inputMode="tel" pattern="3[0-9]{9}" value={telefono} onChange={(e) => setTelefono(e.target.value.replace(/\D/g, ''))} />
      </label>
      <div className="form-columns">
        <label>
          Cargo
          <select value={cargo} onChange={(e) => setCargo(e.target.value as typeof cargo)}>
            {CARGOS.map((c) => (
              <option key={c.codigo} value={c.codigo}>
                {c.etiqueta}
              </option>
            ))}
          </select>
        </label>
        <label>
          Superior
          <select value={superiorId} onChange={(e) => setSuperiorId(e.target.value)} required>
            <option value="">Selecciona uno</option>
            {miembros.map((m) => (
              <option key={m.miembro_id} value={m.miembro_id}>
                {nombrePropio(m.nombre)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      <div className="form-actions">
        <button type="submit" className="primary-button" disabled={guardando}>
          {guardando ? 'Creando...' : 'Crear miembro'}
        </button>
      </div>
    </form>
  );
}

function Metas() {
  const arbol = useQuery({ queryKey: ['red-arbol'], queryFn: api.redArbol });
  return (
    <div className="dashboard-block">
      <MetaMiembroForm miembros={arbol.data ?? []} />
      <MetaTerritorioForm />
    </div>
  );
}

const inicialMeta = { cantidad: '', fechaInicio: '', fechaLimite: '' };

function MetaMiembroForm({ miembros }: { miembros: MiembroRed[] }) {
  const [miembroId, setMiembroId] = useState('');
  const [datos, setDatos] = useState(inicialMeta);
  const [error, setError] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [guardando, setGuardando] = useState(false);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setError('');
    setMensaje('');
    setGuardando(true);
    try {
      await api.crearMetaMiembro({ miembroId, cantidad: Number(datos.cantidad), fechaInicio: datos.fechaInicio, fechaLimite: datos.fechaLimite });
      setMensaje('Meta asignada.');
      setDatos(inicialMeta);
      setMiembroId('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No fue posible asignar la meta.');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form className="visit-form" onSubmit={guardar}>
      <h2>Meta por miembro</h2>
      <label>
        Miembro
        <select value={miembroId} onChange={(e) => setMiembroId(e.target.value)} required>
          <option value="">Selecciona uno</option>
          {miembros.map((m) => (
            <option key={m.miembro_id} value={m.miembro_id}>
              {nombrePropio(m.nombre)}
            </option>
          ))}
        </select>
      </label>
      <div className="form-columns">
        <label>
          Cantidad
          <input type="number" min={1} value={datos.cantidad} onChange={(e) => setDatos({ ...datos, cantidad: e.target.value })} required />
        </label>
        <label>
          Desde
          <input type="date" value={datos.fechaInicio} onChange={(e) => setDatos({ ...datos, fechaInicio: e.target.value })} required />
        </label>
        <label>
          Hasta
          <input type="date" value={datos.fechaLimite} onChange={(e) => setDatos({ ...datos, fechaLimite: e.target.value })} required />
        </label>
      </div>
      {mensaje && (
        <div className="form-error" role="status" style={{ color: '#2e7c68' }}>
          {mensaje}
        </div>
      )}
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      <div className="form-actions">
        <button type="submit" className="primary-button" disabled={guardando}>
          {guardando ? 'Guardando...' : 'Asignar meta'}
        </button>
      </div>
    </form>
  );
}

function MetaTerritorioForm() {
  const [texto, setTexto] = useState('');
  const [resultados, setResultados] = useState<{ id: number; nombre: string; tipo: string }[]>([]);
  const [territorioId, setTerritorioId] = useState('');
  const [territorioNombre, setTerritorioNombre] = useState('');
  const [datos, setDatos] = useState(inicialMeta);
  const [error, setError] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [guardando, setGuardando] = useState(false);

  async function buscar(valor: string) {
    setTexto(valor);
    setResultados(valor.length >= 3 ? await api.buscarTerritorio(valor) : []);
  }

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setError('');
    setMensaje('');
    setGuardando(true);
    try {
      await api.crearMetaTerritorio({
        territorioId: Number(territorioId),
        cantidad: Number(datos.cantidad),
        fechaInicio: datos.fechaInicio,
        fechaLimite: datos.fechaLimite,
      });
      setMensaje('Meta asignada.');
      setDatos(inicialMeta);
      setTerritorioId('');
      setTerritorioNombre('');
      setTexto('');
      setResultados([]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No fue posible asignar la meta.');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form className="visit-form" onSubmit={guardar}>
      <h2>Meta por territorio</h2>
      <label>
        Buscar territorio
        <input value={texto} onChange={(e) => void buscar(e.target.value)} placeholder="Escribe el nombre" />
      </label>
      {resultados.length > 0 && (
        <div className="choice-list">
          {resultados.map((t) => (
            <button
              type="button"
              key={t.id}
              className={territorioId === String(t.id) ? 'selected' : ''}
              onClick={() => {
                setTerritorioId(String(t.id));
                setTerritorioNombre(t.nombre);
                setResultados([]);
                setTexto(t.nombre);
              }}
            >
              {nombrePropio(t.nombre)}
            </button>
          ))}
        </div>
      )}
      {territorioId && (
        <p className="territorio-elegido">
          Territorio elegido: <strong>{territorioNombre}</strong>
        </p>
      )}
      <div className="form-columns">
        <label>
          Cantidad
          <input type="number" min={1} value={datos.cantidad} onChange={(e) => setDatos({ ...datos, cantidad: e.target.value })} required />
        </label>
        <label>
          Desde
          <input type="date" value={datos.fechaInicio} onChange={(e) => setDatos({ ...datos, fechaInicio: e.target.value })} required />
        </label>
        <label>
          Hasta
          <input type="date" value={datos.fechaLimite} onChange={(e) => setDatos({ ...datos, fechaLimite: e.target.value })} required />
        </label>
      </div>
      {mensaje && (
        <div className="form-error" role="status" style={{ color: '#2e7c68' }}>
          {mensaje}
        </div>
      )}
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      <div className="form-actions">
        <button type="submit" className="primary-button" disabled={guardando || !territorioId}>
          {guardando ? 'Guardando...' : 'Asignar meta'}
        </button>
      </div>
    </form>
  );
}
