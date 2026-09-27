import { useMemo, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { api, type LiderRanking, type MetaMiembro, type MiembroRed, type MiLink } from '../api/cliente';
import { Cargando, ErrorEstado } from '../componentes/Estados';
import { Icono } from '../componentes/Icono';
import { useSesion } from '../sesion/SesionContext';
import { nombrePropio } from '../util/nombres';

type Tab = 'enlace' | 'arbol' | 'metas' | 'ranking';
const CARGOS: { codigo: 'COORDINADOR' | 'LIDER' | 'SUBLIDER'; etiqueta: string }[] = [
  { codigo: 'COORDINADOR', etiqueta: 'Coordinador' },
  { codigo: 'LIDER', etiqueta: 'Líder' },
  { codigo: 'SUBLIDER', etiqueta: 'Sublíder' },
];
const ETIQUETA_CARGO: Record<string, string> = { GERENTE: 'Gerente', COORDINADOR: 'Coordinador', LIDER: 'Líder', SUBLIDER: 'Sublíder' };

function formatFecha(v: string | null) {
  if (!v) return 'Sin registros';
  return new Date(v).toLocaleDateString('es-CO', { year: 'numeric', month: 'short', day: 'numeric' });
}

function palabraSimpatizantes(n: number) {
  return `${n} ${n === 1 ? 'simpatizante' : 'simpatizantes'}`;
}

function diasDesde(v: string | null): number | null {
  return v ? Math.floor((Date.now() - new Date(v).getTime()) / 86_400_000) : null;
}

function Avance({ porcentaje }: { porcentaje: number | null }) {
  const valor = Math.max(0, Math.min(100, Number(porcentaje ?? 0)));
  return (
    <span className="avance" title={`${Number(porcentaje ?? 0).toLocaleString('es-CO')} % de la meta`}>
      <span className="goal-track">
        <i className={valor < 50 ? 'low' : ''} style={{ width: `${valor}%` }} />
      </span>
      <b>{Number(porcentaje ?? 0).toLocaleString('es-CO', { maximumFractionDigits: 1 })} %</b>
    </span>
  );
}

export function RedPage() {
  const { tienePermiso } = useSesion();
  const puedeGestionarMiembros = tienePermiso('MIEMBRO_GESTIONAR');
  const puedeGestionarMetas = tienePermiso('META_GESTIONAR');
  const [tab, setTab] = useState<Tab>('enlace');
  const pestanas: [Tab, string][] = [
    ['enlace', 'Mi enlace'],
    ['arbol', 'Árbol de la red'],
    ['metas', 'Metas'],
    ['ranking', 'Ranking'],
  ];

  return (
    <main className="page-content red-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Red de referidos</p>
          <h1>Mi red</h1>
          <p className="dashboard-subtitle">Tu enlace personal, la estructura de coordinadores, líderes y sublíderes, sus metas y su avance.</p>
        </div>
      </div>
      <nav className="agenda-tabs" role="tablist" aria-label="Secciones de mi red">
        {pestanas.map(([clave, etiqueta]) => (
          <button key={clave} type="button" role="tab" aria-selected={tab === clave} className={tab === clave ? 'active' : ''} onClick={() => setTab(clave)}>
            {etiqueta}
          </button>
        ))}
      </nav>
      {tab === 'enlace' && <MiEnlace />}
      {tab === 'arbol' && <Arbol puedeGestionar={puedeGestionarMiembros} />}
      {tab === 'metas' && <Metas puedeGestionar={puedeGestionarMetas} />}
      {tab === 'ranking' && <Ranking />}
    </main>
  );
}

// ---------------------------------------------------------------------------
// Mi enlace: link y QR personal, tarjeta para imprimir y avance propio
// ---------------------------------------------------------------------------

const MENSAJE_WHATSAPP = (url: string) => `Te invito a hacer parte de la campaña. Regístrate aquí: ${url}`;

async function tarjetaConQr(nombre: string, codigo: string, url: string): Promise<string> {
  const qr = await QRCode.toDataURL(url, { margin: 1, width: 520, errorCorrectionLevel: 'M' });
  const imagen = new Image();
  imagen.src = qr;
  await imagen.decode();
  const lienzo = document.createElement('canvas');
  lienzo.width = 720;
  lienzo.height = 1000;
  const c = lienzo.getContext('2d')!;
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, 720, 1000);
  c.fillStyle = '#0b1b2e';
  c.fillRect(0, 0, 720, 200);
  c.fillStyle = '#ffffff';
  c.textAlign = 'center';
  c.font = '600 30px "Public Sans Variable", system-ui, sans-serif';
  c.fillText('Campaña a la Gobernación del Caquetá', 360, 90);
  c.font = '400 24px "Public Sans Variable", system-ui, sans-serif';
  c.fillStyle = '#b7c5d8';
  c.fillText('Escanea y regístrate', 360, 140);
  c.drawImage(imagen, 100, 250, 520, 520);
  c.fillStyle = '#0f1b2d';
  c.font = '600 30px "Public Sans Variable", system-ui, sans-serif';
  c.fillText(`Te invita: ${nombre}`, 360, 840);
  c.fillStyle = '#475467';
  c.font = '400 24px "Public Sans Variable", system-ui, sans-serif';
  c.fillText(`Código ${codigo}`, 360, 885);
  c.font = '400 20px "Public Sans Variable", system-ui, sans-serif';
  c.fillText(url.replace(/^https?:\/\//, ''), 360, 930);
  return lienzo.toDataURL('image/png');
}

function descargar(dataUrl: string, archivo: string) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = archivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function MiEnlace() {
  const cache = useQueryClient();
  const { usuario } = useSesion();
  const links = useQuery({ queryKey: ['red-links'], queryFn: api.misLinks });
  const arbol = useQuery({ queryKey: ['red-arbol'], queryFn: api.redArbol });
  const metas = useQuery({ queryKey: ['tablero-metas'], queryFn: api.metas });
  const principal = links.data?.find((l) => l.es_principal);
  const qr = useQuery({
    queryKey: ['red-link-qr', principal?.url],
    queryFn: () => QRCode.toDataURL(principal!.url, { margin: 1, width: 360 }),
    enabled: Boolean(principal),
  });
  const [copiado, setCopiado] = useState<string>();
  const [error, setError] = useState('');
  const yo = arbol.data?.find((m) => m.es_propio);
  const miMeta = metas.data?.miembros.find((m) => m.miembro_id === yo?.miembro_id);
  const totalReferidos = links.data?.reduce((s, l) => s + l.simpatizantes, 0) ?? 0;
  const nombre = nombrePropio(`${usuario?.nombres ?? ''} ${usuario?.apellidos ?? ''}`);

  async function copiar(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopiado(url);
      setTimeout(() => setCopiado(undefined), 2000);
    } catch {
      setError('No se pudo copiar el enlace: cópialo a mano.');
    }
  }

  if (links.isPending) return <Cargando texto="Cargando tu enlace..." />;
  if (links.isError) return <ErrorEstado mensaje={links.error.message} reintentar={() => void links.refetch()} />;

  return (
    <>
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      {principal ? (
        <section className="dashboard-block enlace-personal">
          <div className="enlace-qr">{qr.data ? <img src={qr.data} alt={`Código QR de tu enlace ${principal.codigo}`} width={180} height={180} /> : <Cargando texto="" />}</div>
          <div className="enlace-datos">
            <p className="eyebrow">Tu enlace personal</p>
            <h2>
              Código <span className="codigo">{principal.codigo}</span>
            </h2>
            <code>{principal.url}</code>
            <p className="helper">Quien se registre con este enlace o escaneando el código queda en tu red.</p>
            <div className="form-actions">
              <button type="button" className="primary-button" onClick={() => void copiar(principal.url)}>
                <Icono nombre={copiado === principal.url ? 'check' : 'copiar'} tamano={16} />
                {copiado === principal.url ? 'Copiado' : 'Copiar enlace'}
              </button>
              <a className="secondary-button" href={`https://wa.me/?text=${encodeURIComponent(MENSAJE_WHATSAPP(principal.url))}`} target="_blank" rel="noreferrer">
                Compartir por WhatsApp
              </a>
              {qr.data && (
                <button type="button" className="secondary-button" onClick={() => descargar(qr.data, `qr-${principal.codigo}.png`)}>
                  Descargar QR
                </button>
              )}
              <button
                type="button"
                className="secondary-button"
                onClick={() => void tarjetaConQr(nombre, principal.codigo, principal.url).then((t) => descargar(t, `tarjeta-${principal.codigo}.png`))}
              >
                Tarjeta para imprimir
              </button>
            </div>
          </div>
          <div className="enlace-cifras">
            <div>
              <span>Referidos</span>
              <strong>{totalReferidos.toLocaleString('es-CO')}</strong>
            </div>
            {miMeta && (
              <div>
                <span>
                  Tu meta: {Number(miMeta.registrados ?? 0).toLocaleString('es-CO')} de {Number(miMeta.meta ?? 0).toLocaleString('es-CO')}
                </span>
                <Avance porcentaje={miMeta.porcentaje} />
                <small>Vence el {formatFecha(miMeta.fecha_limite)}</small>
              </div>
            )}
          </div>
        </section>
      ) : (
        <div className="empty-inline">Tu usuario no es parte de la estructura de campaña, por eso no tiene enlace personal.</div>
      )}
      <OtrosLinks links={links.data} onCambio={() => void cache.invalidateQueries({ queryKey: ['red-links'] })} copiar={copiar} copiado={copiado} />
    </>
  );
}

function OtrosLinks({ links, onCambio, copiar, copiado }: { links: MiLink[]; onCambio: () => void; copiar: (url: string) => Promise<void>; copiado?: string }) {
  const [expiraEn, setExpiraEn] = useState('');
  const [creando, setCreando] = useState(false);
  const [error, setError] = useState('');
  const [qrAbierto, setQrAbierto] = useState<string>();
  const adicionales = links.filter((l) => !l.es_principal);

  async function crear(e: FormEvent) {
    e.preventDefault();
    setError('');
    setCreando(true);
    try {
      await api.crearLink(expiraEn ? new Date(expiraEn).toISOString() : undefined);
      setExpiraEn('');
      onCambio();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No fue posible crear el enlace.');
    } finally {
      setCreando(false);
    }
  }

  async function alternar(link: MiLink) {
    setError('');
    try {
      await api.actualizarLink(link.id, !link.activo);
      onCambio();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No fue posible cambiar el estado del enlace.');
    }
  }

  return (
    <section className="dashboard-block">
      <div className="block-heading">
        <div>
          <h2>Enlaces adicionales</h2>
          <small style={{ color: 'var(--texto-3)' }}>Para eventos o campañas puntuales: puedes ponerles fecha de vencimiento y desactivarlos.</small>
        </div>
      </div>
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      {adicionales.length > 0 && (
        <div className="table-wrap" style={{ marginBottom: 12 }}>
          <table>
            <thead>
              <tr>
                <th>Código</th>
                <th>Referidos</th>
                <th>Vence</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {adicionales.map((link) => (
                <tr key={link.id}>
                  <td>
                    <strong>{link.codigo}</strong>
                  </td>
                  <td>{palabraSimpatizantes(link.simpatizantes)}</td>
                  <td>{link.expira_en ? formatFecha(link.expira_en) : 'No vence'}</td>
                  <td>
                    <span className={`estado-pill ${link.activo ? 'estado-activo' : 'estado-retirado'}`}>{link.activo ? 'Activo' : 'Inactivo'}</span>
                  </td>
                  <td>
                    <div className="row-actions">
                      <button type="button" className="link-button" onClick={() => void copiar(link.url)}>
                        {copiado === link.url ? 'Copiado' : 'Copiar'}
                      </button>
                      <button type="button" className="link-button" onClick={() => setQrAbierto(qrAbierto === link.url ? undefined : link.url)}>
                        {qrAbierto === link.url ? 'Ocultar QR' : 'QR'}
                      </button>
                      <button type="button" className="link-button" onClick={() => void alternar(link)}>
                        {link.activo ? 'Desactivar' : 'Activar'}
                      </button>
                    </div>
                    {qrAbierto === link.url && <QrDescargable codigo={link.codigo} url={link.url} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <form className="filter-row" style={{ padding: 0, border: 0, margin: 0 }} onSubmit={crear}>
        <label>
          Vence el <span className="optional">opcional</span>
          <input type="datetime-local" value={expiraEn} onChange={(e) => setExpiraEn(e.target.value)} />
        </label>
        <button type="submit" className="secondary-button" disabled={creando}>
          {creando ? 'Creando...' : 'Crear enlace adicional'}
        </button>
      </form>
    </section>
  );
}

function QrDescargable({ codigo, url }: { codigo: string; url: string }) {
  const qr = useQuery({ queryKey: ['red-link-qr', url], queryFn: () => QRCode.toDataURL(url, { margin: 1, width: 240 }) });
  if (qr.isPending) return <Cargando texto="Generando código QR..." />;
  if (qr.isError || !qr.data) return <p className="form-error">No fue posible generar el código QR.</p>;
  return (
    <div className="qr-panel">
      <img src={qr.data} alt={`Código QR del enlace ${codigo}`} width={120} height={120} />
      <a className="secondary-button" href={qr.data} download={`qr-${codigo}.png`}>
        Descargar PNG
      </a>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Árbol: coordinador → líder → sublíder → votantes
// ---------------------------------------------------------------------------

type Nodo = MiembroRed & { hijos: Nodo[]; totalRed: number };

function armarArbol(filas: MiembroRed[]): Nodo[] {
  const nodos = new Map<string, Nodo>(filas.map((f) => [f.miembro_id, { ...f, hijos: [], totalRed: 0 }]));
  const raices: Nodo[] = [];
  for (const n of nodos.values()) {
    const padre = n.superior_id ? nodos.get(n.superior_id) : undefined;
    if (padre) padre.hijos.push(n);
    else raices.push(n);
  }
  const sumar = (n: Nodo): number => (n.totalRed = (n.activos ?? 0) + n.hijos.reduce((s, h) => s + sumar(h), 0));
  raices.forEach(sumar);
  const ordenar = (lista: Nodo[]) => {
    lista.sort((a, b) => b.totalRed - a.totalRed || a.nombre.localeCompare(b.nombre, 'es'));
    lista.forEach((n) => ordenar(n.hijos));
  };
  ordenar(raices);
  return raices;
}

function Arbol({ puedeGestionar }: { puedeGestionar: boolean }) {
  const cache = useQueryClient();
  const { tienePermiso } = useSesion();
  const arbol = useQuery({ queryKey: ['red-arbol'], queryFn: api.redArbol });
  const metas = useQuery({ queryKey: ['tablero-metas'], queryFn: api.metas });
  const [abiertos, setAbiertos] = useState<Set<string> | null>(null);
  const [creandoAbierto, setCreandoAbierto] = useState(false);
  const [error, setError] = useState('');
  const raices = useMemo(() => armarArbol(arbol.data ?? []), [arbol.data]);
  const metaPorMiembro = useMemo(() => new Map((metas.data?.miembros ?? []).map((m) => [m.miembro_id, m])), [metas.data]);

  // Por defecto: abiertos los dos primeros niveles.
  const visibles = abiertos ?? new Set(raices.flatMap((r) => [r.miembro_id, ...r.hijos.map((h) => h.miembro_id)]));
  const alternar = (id: string) =>
    setAbiertos(() => {
      const s = new Set(visibles);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });

  async function actualizar(m: MiembroRed, cambio: { activo?: boolean; superiorId?: string }) {
    setError('');
    try {
      await api.actualizarMiembro(m.miembro_id, cambio);
      await cache.invalidateQueries({ queryKey: ['red-arbol'] });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No fue posible actualizar al miembro.');
    }
  }

  if (arbol.isPending) return <Cargando texto="Cargando la estructura..." />;
  if (arbol.isError) return <ErrorEstado mensaje={arbol.error.message} reintentar={() => void arbol.refetch()} />;

  return (
    <section className="dashboard-block">
      <div className="block-heading">
        <div>
          <h2>Coordinador → líder → sublíder → votantes</h2>
          <small style={{ color: 'var(--texto-3)' }}>Ordenado por simpatizantes de cada red. Abre un miembro para ver a quienes refirió.</small>
        </div>
        <div className="form-actions">
          <button type="button" className="secondary-button" onClick={() => setAbiertos(new Set(arbol.data.map((m) => m.miembro_id)))}>
            Expandir todo
          </button>
          <button type="button" className="secondary-button" onClick={() => setAbiertos(new Set())}>
            Contraer
          </button>
          {puedeGestionar && (
            <button type="button" className="primary-button" onClick={() => setCreandoAbierto(!creandoAbierto)}>
              {creandoAbierto ? 'Cancelar' : 'Agregar miembro'}
            </button>
          )}
        </div>
      </div>
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      {creandoAbierto && (
        <CrearMiembroForm
          miembros={arbol.data}
          onDone={async () => {
            setCreandoAbierto(false);
            await cache.invalidateQueries({ queryKey: ['red-arbol'] });
          }}
        />
      )}
      {raices.length === 0 ? (
        <div className="empty-inline">Tu usuario no tiene una red asignada.</div>
      ) : (
        <ul className="arbol-red">
          {raices.map((n) => (
            <RamaRed
              key={n.miembro_id}
              nodo={n}
              abiertos={visibles}
              alternar={alternar}
              metas={metaPorMiembro}
              todos={arbol.data}
              puedeGestionar={puedeGestionar}
              puedeVerVotantes={tienePermiso('SIMPATIZANTE_VER')}
              actualizar={actualizar}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function RamaRed({
  nodo,
  abiertos,
  alternar,
  metas,
  todos,
  puedeGestionar,
  puedeVerVotantes,
  actualizar,
}: {
  nodo: Nodo;
  abiertos: Set<string>;
  alternar: (id: string) => void;
  metas: Map<string | null, MetaMiembro>;
  todos: MiembroRed[];
  puedeGestionar: boolean;
  puedeVerVotantes: boolean;
  actualizar: (m: MiembroRed, cambio: { activo?: boolean; superiorId?: string }) => Promise<void>;
}) {
  const abierto = abiertos.has(nodo.miembro_id);
  const [verVotantes, setVerVotantes] = useState(false);
  const meta = metas.get(nodo.miembro_id);
  const tieneContenido = nodo.hijos.length > 0 || (puedeVerVotantes && (nodo.activos ?? 0) > 0);
  return (
    <li>
      <div className={`nodo-red ${nodo.activo ? '' : 'inactivo'}`}>
        {tieneContenido ? (
          <button type="button" className="nodo-alternar" aria-expanded={abierto} aria-label={abierto ? 'Contraer' : 'Expandir'} onClick={() => alternar(nodo.miembro_id)}>
            <Icono nombre="flechaAbajo" tamano={16} />
          </button>
        ) : (
          <span style={{ width: 26, flex: 'none' }} />
        )}
        <span className={`cargo-marca cargo-${nodo.cargo_codigo.toLowerCase()}`}>{(ETIQUETA_CARGO[nodo.cargo_codigo] ?? nodo.cargo_codigo).charAt(0)}</span>
        <div className="nodo-principal">
          <strong>{nombrePropio(nodo.nombre)}</strong>
          <small>
            {ETIQUETA_CARGO[nodo.cargo_codigo] ?? nodo.cargo_codigo}
            {nodo.hijos.length > 0 && ` · ${nodo.hijos.length} a cargo`}
            {' · '}
            {nodo.ultimo_registro ? `último registro ${formatFecha(nodo.ultimo_registro)}` : 'sin registros propios'}
            {!nodo.activo && ' · inactivo'}
          </small>
        </div>
        {meta && (
          <div className="nodo-meta">
            <Avance porcentaje={meta.porcentaje} />
          </div>
        )}
        <div className="nodo-cifras">
          <strong>{nodo.totalRed.toLocaleString('es-CO')}</strong>
          <small>{nodo.hijos.length > 0 ? `en su red · ${(nodo.activos ?? 0).toLocaleString('es-CO')} propios` : 'referidos'}</small>
        </div>
        {puedeGestionar && !nodo.es_propio && nodo.cargo_codigo !== 'GERENTE' && (
          <details className="nodo-menu">
            <summary aria-label={`Opciones de ${nombrePropio(nodo.nombre)}`}>···</summary>
            <div>
              <button type="button" className="link-button" onClick={() => void actualizar(nodo, { activo: !nodo.activo })}>
                {nodo.activo ? 'Desactivar' : 'Activar'}
              </button>
              <label>
                Mover bajo
                <select value="" onChange={(e) => e.target.value && void actualizar(nodo, { superiorId: e.target.value })}>
                  <option value="">Elegir superior…</option>
                  {todos
                    .filter((o) => o.miembro_id !== nodo.miembro_id && o.miembro_id !== nodo.superior_id && o.cargo_codigo !== 'SUBLIDER')
                    .map((o) => (
                      <option key={o.miembro_id} value={o.miembro_id}>
                        {nombrePropio(o.nombre)}
                      </option>
                    ))}
                </select>
              </label>
            </div>
          </details>
        )}
      </div>
      {abierto && (
        <ul className="arbol-red">
          {nodo.hijos.map((h) => (
            <RamaRed
              key={h.miembro_id}
              nodo={h}
              abiertos={abiertos}
              alternar={alternar}
              metas={metas}
              todos={todos}
              puedeGestionar={puedeGestionar}
              puedeVerVotantes={puedeVerVotantes}
              actualizar={actualizar}
            />
          ))}
          {puedeVerVotantes && (nodo.activos ?? 0) > 0 && (
            <li>
              {verVotantes ? (
                <Votantes miembroId={nodo.miembro_id} />
              ) : (
                <button type="button" className="link-button votantes-boton" onClick={() => setVerVotantes(true)}>
                  <Icono nombre="personas" tamano={15} /> Ver sus {(nodo.activos ?? 0).toLocaleString('es-CO')} votantes referidos
                </button>
              )}
            </li>
          )}
        </ul>
      )}
    </li>
  );
}

function Votantes({ miembroId }: { miembroId: string }) {
  const [pagina, setPagina] = useState(1);
  const lista = useQuery({
    queryKey: ['red-votantes', miembroId, pagina],
    queryFn: () => api.listarSimpatizantes({ liderId: miembroId, pagina, porPagina: 25 }),
  });
  if (lista.isPending) return <Cargando texto="Cargando votantes..." />;
  if (lista.isError) return <ErrorEstado mensaje={lista.error.message} />;
  return (
    <div className="votantes">
      <ul>
        {lista.data.datos.map((s) => (
          <li key={s.persona_id}>
            <span className="cargo-marca cargo-votante">V</span>
            <span>
              {nombrePropio(`${s.nombres ?? ''} ${s.apellidos ?? ''}`)}
              <small>
                {nombrePropio(s.territorio_residencia)}
                {s.municipio && s.municipio !== s.territorio_residencia ? ` · ${nombrePropio(s.municipio)}` : ''} · {formatFecha(s.capturado_en)}
              </small>
            </span>
          </li>
        ))}
      </ul>
      {lista.data.total > 25 && (
        <div className="pager">
          <button type="button" disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)}>
            Anterior
          </button>
          <span>
            {(pagina - 1) * 25 + 1}–{Math.min(pagina * 25, lista.data.total)} de {lista.data.total}
          </span>
          <button type="button" disabled={pagina * 25 >= lista.data.total} onClick={() => setPagina(pagina + 1)}>
            Siguiente
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Metas: avance por líder y por municipio, y asignación
// ---------------------------------------------------------------------------

function Metas({ puedeGestionar }: { puedeGestionar: boolean }) {
  const metas = useQuery({ queryKey: ['tablero-metas'], queryFn: api.metas });
  const arbol = useQuery({ queryKey: ['red-arbol'], queryFn: api.redArbol, enabled: puedeGestionar });
  const [asignando, setAsignando] = useState(false);
  if (metas.isPending) return <Cargando texto="Cargando metas..." />;
  if (metas.isError) return <ErrorEstado mensaje={metas.error.message} reintentar={() => void metas.refetch()} />;
  const filas = (lista: { clave: string; nombre: string; meta: number | null; registrados: number | null; porcentaje: number | null; fecha: string | null }[]) =>
    lista.length === 0 ? (
      <div className="empty-inline">Aún no hay metas asignadas.</div>
    ) : (
      lista
        .sort((a, b) => Number(b.porcentaje ?? 0) - Number(a.porcentaje ?? 0))
        .map((f) => (
          <div className="goal-row" key={f.clave}>
            <div className="goal-label">
              <strong>{nombrePropio(f.nombre)}</strong>
              <span>
                {Number(f.registrados ?? 0).toLocaleString('es-CO')} de {Number(f.meta ?? 0).toLocaleString('es-CO')} · vence {formatFecha(f.fecha)}
              </span>
            </div>
            <div className="goal-track">
              <i className={Number(f.porcentaje ?? 0) < 50 ? 'low' : ''} style={{ width: `${Math.min(100, Number(f.porcentaje ?? 0))}%` }} />
            </div>
            <b>{Number(f.porcentaje ?? 0).toLocaleString('es-CO', { maximumFractionDigits: 1 })} %</b>
          </div>
        ))
    );
  return (
    <>
      <section className="dashboard-block">
        <div className="block-heading">
          <h2>Avance de metas</h2>
          {puedeGestionar && (
            <button type="button" className="primary-button" onClick={() => setAsignando(!asignando)}>
              {asignando ? 'Cerrar' : 'Asignar meta'}
            </button>
          )}
        </div>
        <div className="goals-grid">
          <div>
            <h3>Por líder</h3>
            {filas(metas.data.miembros.map((m) => ({ clave: `${m.miembro_id}-${m.fecha_limite}`, nombre: m.nombre ?? 'Miembro', meta: m.meta, registrados: m.registrados, porcentaje: m.porcentaje, fecha: m.fecha_limite })))}
          </div>
          <div>
            <h3>Por municipio</h3>
            {filas(metas.data.territorios.map((t) => ({ clave: `${t.territorio_id}-${t.fecha_limite}`, nombre: t.territorio ?? 'Territorio', meta: t.meta, registrados: t.registrados, porcentaje: t.porcentaje, fecha: t.fecha_limite })))}
          </div>
        </div>
      </section>
      {puedeGestionar && asignando && (
        <section className="dashboard-block">
          <MetaMiembroForm miembros={arbol.data ?? []} />
          <MetaTerritorioForm />
        </section>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Ranking, reconocimientos y líderes inactivos
// ---------------------------------------------------------------------------

type Reconocimiento = { clave: string; nombre: string; icono: 'tendencia' | 'meta' | 'check' | 'personas'; descripcion: string };

const RECONOCIMIENTOS: Reconocimiento[] = [
  { clave: 'podio', nombre: 'Podio', icono: 'tendencia', descripcion: 'Entre los 3 con más simpatizantes activos' },
  { clave: 'semana', nombre: 'Líder de la semana', icono: 'personas', descripcion: 'El que más registró en los últimos 7 días' },
  { clave: 'meta', nombre: 'Meta cumplida', icono: 'check', descripcion: 'Llegó al 100 % de su meta' },
  { clave: 'mitad', nombre: 'Mitad del camino', icono: 'meta', descripcion: 'Superó el 50 % de su meta' },
];

function Ranking() {
  const ranking = useQuery({ queryKey: ['red-ranking'], queryFn: () => api.ranking(100) });
  const metas = useQuery({ queryKey: ['tablero-metas'], queryFn: api.metas });
  const inactivos = useQuery({ queryKey: ['red-inactivos'], queryFn: api.lideresInactivos });
  const configuracion = useQuery({ queryKey: ['tablero-configuracion'], queryFn: api.configuracionTablero });
  const [periodo, setPeriodo] = useState<'total' | 'semana'>('total');

  const valor = (r: LiderRanking) => Number((periodo === 'total' ? r.activos : r.ultimos_7_dias) ?? 0);
  const ordenado = useMemo(() => [...(ranking.data ?? [])].sort((a, b) => valor(b) - valor(a) || (a.nombre ?? '').localeCompare(b.nombre ?? '', 'es')),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ranking.data, periodo]);

  const reconocimientos = useMemo(() => {
    const porMiembro = new Map<string, string[]>();
    const agregar = (id: string | null, clave: string) => {
      if (!id) return;
      porMiembro.set(id, [...(porMiembro.get(id) ?? []), clave]);
    };
    const porTotal = [...(ranking.data ?? [])].filter((r) => Number(r.activos ?? 0) > 0).sort((a, b) => Number(b.activos ?? 0) - Number(a.activos ?? 0));
    porTotal.slice(0, 3).forEach((r) => agregar(r.miembro_id, 'podio'));
    const mejorSemana = Math.max(0, ...(ranking.data ?? []).map((r) => Number(r.ultimos_7_dias ?? 0)));
    if (mejorSemana > 0) (ranking.data ?? []).filter((r) => Number(r.ultimos_7_dias ?? 0) === mejorSemana).forEach((r) => agregar(r.miembro_id, 'semana'));
    for (const m of metas.data?.miembros ?? []) {
      if (Number(m.porcentaje ?? 0) >= 100) agregar(m.miembro_id, 'meta');
      else if (Number(m.porcentaje ?? 0) >= 50) agregar(m.miembro_id, 'mitad');
    }
    return porMiembro;
  }, [ranking.data, metas.data]);

  if (ranking.isPending) return <Cargando texto="Cargando ranking..." />;
  if (ranking.isError) return <ErrorEstado mensaje={ranking.error.message} reintentar={() => void ranking.refetch()} />;
  const maximo = Math.max(1, ...ordenado.map(valor));
  const dias = configuracion.data?.liderInactivoDias ?? 7;

  return (
    <div className="dashboard-two-columns ranking-red">
      <section className="dashboard-block">
        <div className="block-heading">
          <div>
            <h2>Ranking de líderes</h2>
            <small style={{ color: 'var(--texto-3)' }}>Dentro de tu alcance</small>
          </div>
          <div className="segmented" role="group" aria-label="Periodo">
            <button type="button" className={periodo === 'total' ? 'selected' : ''} onClick={() => setPeriodo('total')}>
              Total
            </button>
            <button type="button" className={periodo === 'semana' ? 'selected' : ''} onClick={() => setPeriodo('semana')}>
              Últimos 7 días
            </button>
          </div>
        </div>
        {ordenado.length === 0 ? (
          <div className="empty-inline">No hay líderes en tu alcance.</div>
        ) : (
          <ol className="ranking-lista">
            {ordenado.map((r, i) => (
              <li key={r.miembro_id ?? i}>
                <span className={`puesto puesto-${i < 3 && valor(r) > 0 ? i + 1 : 'otro'}`}>{i + 1}</span>
                <div className="ranking-persona">
                  <strong>{nombrePropio(r.nombre)}</strong>
                  <span className="ranking-barra">
                    <i style={{ width: `${(valor(r) / maximo) * 100}%` }} />
                  </span>
                  <span className="insignias">
                    {(reconocimientos.get(r.miembro_id ?? '') ?? []).map((clave) => {
                      const rec = RECONOCIMIENTOS.find((x) => x.clave === clave)!;
                      return (
                        <span key={clave} className={`insignia insignia-${clave}`} title={rec.descripcion}>
                          <Icono nombre={rec.icono} tamano={12} /> {rec.nombre}
                        </span>
                      );
                    })}
                  </span>
                </div>
                <b>{valor(r).toLocaleString('es-CO')}</b>
              </li>
            ))}
          </ol>
        )}
        <details className="chart-alt">
          <summary>¿Cómo se ganan los reconocimientos?</summary>
          <ul className="reconocimientos-guia">
            {RECONOCIMIENTOS.map((rec) => (
              <li key={rec.clave}>
                <span className={`insignia insignia-${rec.clave}`}>
                  <Icono nombre={rec.icono} tamano={12} /> {rec.nombre}
                </span>{' '}
                {rec.descripcion}
              </li>
            ))}
          </ul>
        </details>
      </section>

      <section className="dashboard-block">
        <div className="block-heading">
          <div>
            <h2>Líderes inactivos</h2>
            <small style={{ color: 'var(--texto-3)' }}>Sin registros en los últimos {dias} días: necesitan acompañamiento</small>
          </div>
          {inactivos.data && inactivos.data.length > 0 && <span className="estado-pill severidad-media">{inactivos.data.length}</span>}
        </div>
        {inactivos.isPending && <Cargando />}
        {inactivos.data?.length === 0 && (
          <div className="empty-inline">
            <Icono nombre="check" tamano={16} /> Todos los líderes de tu alcance registraron en los últimos {dias} días.
          </div>
        )}
        {inactivos.data && inactivos.data.length > 0 && (
          <ul className="inactivos-lista">
            {inactivos.data.map((r) => {
              const d = diasDesde(r.ultimo_registro);
              return (
                <li key={r.miembro_id ?? r.nombre}>
                  <span className="inactive-dot" />
                  <span>
                    <strong>{nombrePropio(r.nombre)}</strong>
                    <small>
                      {ETIQUETA_CARGO[r.cargo_codigo ?? ''] ?? r.cargo_codigo} · {Number(r.activos ?? 0).toLocaleString('es-CO')} referidos
                    </small>
                  </span>
                  <span className={`estado-pill ${d === null || d > dias * 2 ? 'severidad-alta' : 'severidad-media'}`}>{d === null ? 'Nunca ha registrado' : `Hace ${d} días`}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
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
  const [municipioId, setMunicipioId] = useState('');
  const municipios = useQuery({ queryKey: ['municipios'], queryFn: api.municipios, enabled: cargo === 'COORDINADOR' });
  const [error, setError] = useState('');
  const [exito, setExito] = useState<{ codigoLink: string; urlLink: string }>();
  const [guardando, setGuardando] = useState(false);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setError('');
    setGuardando(true);
    try {
      const res = await api.crearMiembro({
        documento,
        nombres: nombres.trim(),
        apellidos: apellidos.trim(),
        telefono: telefono || undefined,
        cargo,
        superiorId,
        territorioIds: cargo === 'COORDINADOR' ? [Number(municipioId)] : undefined,
      });
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
      {cargo === 'COORDINADOR' ? (
        <label>
          Municipio del coordinador
          <select value={municipioId} onChange={(e) => setMunicipioId(e.target.value)} required>
            <option value="">{municipios.isPending ? 'Cargando municipios…' : 'Selecciona el municipio'}</option>
            {(municipios.data ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {nombrePropio(m.nombre)}
              </option>
            ))}
          </select>
          <small className="helper">Solo verá y gestionará a los líderes de este municipio.</small>
        </label>
      ) : (
        <p className="helper">Líderes y sublíderes quedan en el municipio de su superior.</p>
      )}
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
