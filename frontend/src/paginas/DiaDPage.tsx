import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, type FormularioRevision, type MiMesa, type OpcionVoto, type PuestoDiaD } from '../api/cliente';
import { Cargando, ErrorEstado } from '../componentes/Estados';
import { Icono } from '../componentes/Icono';
import { useSesion } from '../sesion/SesionContext';
import { nombrePropio } from '../util/nombres';

type Tab = 'mis-mesas' | 'conteo' | 'testigos' | 'revision' | 'configuracion';
const numero = (n: number | null | undefined) => (n ?? 0).toLocaleString('es-CO');
const hora = (v: string | null) => (v ? new Date(v).toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' }) : '—');
const error = (e: unknown, porDefecto: string) => (e instanceof Error ? e.message : porDefecto);
const CORPORACION: Record<string, string> = { GOBERNACION: 'Gobernación', ASAMBLEA: 'Asamblea', ALCALDIA: 'Alcaldía', CONCEJO: 'Concejo', JAL: 'JAL' };
const nombreCorporacion = (c: string) => CORPORACION[c] ?? nombrePropio(c);
const ESTADO_E14: Record<string, string> = { PENDIENTE: 'Por revisar', VALIDADO: 'Validado', CON_INCONSISTENCIAS: 'Con inconsistencias' };

/** Achica la foto en el celular (lado mayor 2200 px, JPEG): menos datos en zonas con mala señal. */
async function comprimirFoto(archivo: File): Promise<Blob> {
  const imagen = await createImageBitmap(archivo).catch(() => null);
  if (!imagen) return archivo;
  const escala = Math.min(1, 2200 / Math.max(imagen.width, imagen.height));
  const lienzo = document.createElement('canvas');
  lienzo.width = Math.round(imagen.width * escala);
  lienzo.height = Math.round(imagen.height * escala);
  lienzo.getContext('2d')!.drawImage(imagen, 0, 0, lienzo.width, lienzo.height);
  return new Promise((r) => lienzo.toBlob((b) => r(b ?? archivo), 'image/jpeg', 0.85));
}

/** Módulo del día de elecciones: testigos, E-14 y conteo rápido. */
export function DiaDPage() {
  const { tienePermiso } = useSesion();
  const tabs = (
    [
      ['mis-mesas', 'Mis mesas', tienePermiso('E14_CARGAR')],
      ['conteo', 'Conteo en vivo', tienePermiso('DIA_D_VER')],
      ['testigos', 'Testigos y mesas', tienePermiso('DIA_D_GESTIONAR')],
      ['revision', 'Revisión de E-14', tienePermiso('DIA_D_GESTIONAR')],
      ['configuracion', 'Configuración', tienePermiso('DIA_D_CONFIGURAR')],
    ] as [Tab, string, boolean][]
  ).filter(([, , ver]) => ver);
  const [tab, setTab] = useState<Tab>(tabs[0]?.[0] ?? 'mis-mesas');
  const jornadas = useQuery({ queryKey: ['dia-d', 'jornadas'], queryFn: api.diaDJornadas });
  const activa = jornadas.data?.find((j) => j.activa);

  return (
    <main className="page-content">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Día de elecciones</p>
          <h1>Día D</h1>
          <p className="dashboard-subtitle">
            {activa ? `${activa.nombre} · ${new Date(`${activa.fecha}T12:00:00`).toLocaleDateString('es-CO', { dateStyle: 'long' })}` : 'Sin jornada activa'}
          </p>
        </div>
      </div>
      {tabs.length > 1 && (
        <nav className="agenda-tabs" aria-label="Secciones del día de elecciones">
          {tabs.map(([clave, etiqueta]) => (
            <button key={clave} type="button" className={tab === clave ? 'active' : ''} onClick={() => setTab(clave)}>
              {etiqueta}
            </button>
          ))}
        </nav>
      )}
      {tab === 'mis-mesas' && <MisMesas />}
      {tab === 'conteo' && <Conteo corporaciones={activa?.corporaciones ?? ['GOBERNACION']} />}
      {tab === 'testigos' && <Testigos />}
      {tab === 'revision' && <Revision />}
      {tab === 'configuracion' && <Configuracion corporaciones={activa?.corporaciones ?? ['GOBERNACION']} />}
    </main>
  );
}

// ---------------------------------------------------------------------------
// Testigo: sus mesas y la carga del E-14
// ---------------------------------------------------------------------------
function MisMesas() {
  const mesas = useQuery({ queryKey: ['dia-d', 'mis-mesas'], queryFn: api.diaDMisMesas });
  const [abierta, setAbierta] = useState<MiMesa>();
  if (mesas.isPending) return <Cargando />;
  if (mesas.isError) return <ErrorEstado mensaje={mesas.error.message} />;
  if (abierta) return <CargarE14 mesa={abierta} onVolver={() => setAbierta(undefined)} />;
  if (!mesas.data.length) {
    return (
      <section className="dashboard-block dia-d-vacio">
        <Icono nombre="calendario" tamano={22} />
        <div>
          <h2>Todavía no tienes mesas asignadas</h2>
          <p className="helper">La coordinación te asignará tu puesto y tus mesas. Cuando lo haga, aparecerán aquí para cargar el E-14.</p>
        </div>
      </section>
    );
  }
  return (
    <section className="mis-mesas">
      {mesas.data.map((m) => (
        <button key={`${m.mesa_id}-${m.corporacion}`} type="button" className="mesa-tarjeta" onClick={() => setAbierta(m)}>
          <span className="eyebrow">{m.corporacion_nombre}</span>
          <strong>Mesa {m.numero}</strong>
          <span>
            {nombrePropio(m.puesto)} · {nombrePropio(m.municipio)}
          </span>
          {m.formulario_id ? (
            <span className={`estado-pill ${m.estado_revision === 'CON_INCONSISTENCIAS' ? 'estado-aviso' : 'estado-bien'}`}>
              E-14 cargado {hora(m.cargado_en)} · {numero(m.total_votos)} votos
            </span>
          ) : (
            <span className="estado-pill estado-aviso">Falta el E-14</span>
          )}
        </button>
      ))}
    </section>
  );
}

function CargarE14({ mesa, onVolver }: { mesa: MiMesa; onVolver: () => void }) {
  const cache = useQueryClient();
  const opciones = useQuery({ queryKey: ['dia-d', 'opciones', mesa.corporacion], queryFn: () => api.diaDOpciones(mesa.corporacion) });
  const [votos, setVotos] = useState<Record<number, string>>({});
  const [foto, setFoto] = useState<Blob>();
  const [vista, setVista] = useState<string>();
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string }>();
  const [enviando, setEnviando] = useState(false);
  const total = Object.values(votos).reduce((s, v) => s + (Number(v) || 0), 0);

  useEffect(() => () => void (vista && URL.revokeObjectURL(vista)), [vista]);

  async function elegirFoto(archivo?: File) {
    if (!archivo) return;
    const comprimida = await comprimirFoto(archivo);
    setFoto(comprimida);
    setVista(URL.createObjectURL(comprimida));
  }

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (!foto) return setAviso({ ok: false, texto: 'Toma la foto del formulario E-14.' });
    setEnviando(true);
    setAviso(undefined);
    try {
      const datos = new FormData();
      datos.append('mesaId', String(mesa.mesa_id));
      datos.append('corporacion', mesa.corporacion);
      datos.append('votos', JSON.stringify(Object.fromEntries((opciones.data ?? []).map((o) => [o.id, Number(votos[o.id] || 0)]))));
      datos.append('foto', foto, 'e14.jpg');
      const r = await api.diaDCargarE14(datos);
      setAviso({ ok: r.estado !== 'CON_INCONSISTENCIAS', texto: r.mensaje });
      void cache.invalidateQueries({ queryKey: ['dia-d', 'mis-mesas'] });
    } catch (causa) {
      setAviso({ ok: false, texto: error(causa, 'No se pudo guardar el E-14. Revisa la señal e inténtalo de nuevo.') });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form className="dashboard-block e14-form" onSubmit={guardar}>
      <button type="button" className="back-link" onClick={onVolver}>
        ← Mis mesas
      </button>
      <h2>
        Mesa {mesa.numero} · {mesa.corporacion_nombre}
      </h2>
      <p className="helper">
        {nombrePropio(mesa.puesto)} · {nombrePropio(mesa.municipio)}
        {mesa.formulario_id && ' · Ya hay un E-14 cargado: si guardas de nuevo, lo reemplazas (mientras no esté validado).'}
      </p>
      <label className="e14-foto">
        <span>1. Foto del formulario E-14 completo, con buena luz y sin cortar bordes</span>
        <input type="file" accept="image/*" capture="environment" onChange={(e) => void elegirFoto(e.target.files?.[0])} />
        {vista && <img src={vista} alt="Vista previa del E-14" />}
      </label>
      <fieldset className="e14-votos">
        <legend>2. Votos escritos en el E-14</legend>
        {opciones.isPending && <Cargando />}
        {opciones.data?.map((o) => (
          <label key={o.id} className={o.es_candidato_propio ? 'propio' : ''}>
            <span>
              {o.nombre}
              {o.partido && <small>{o.partido}</small>}
            </span>
            <input
              inputMode="numeric"
              pattern="[0-9]{1,4}"
              value={votos[o.id] ?? ''}
              onChange={(e) => setVotos({ ...votos, [o.id]: e.target.value.replace(/\D/g, '').slice(0, 4) })}
              required
              placeholder="0"
            />
          </label>
        ))}
        <p className="e14-total">
          Total: <strong>{numero(total)}</strong>
        </p>
      </fieldset>
      {aviso && <p className={aviso.ok ? 'form-success' : 'form-error'}>{aviso.texto}</p>}
      <button className="primary-button" disabled={enviando || !opciones.data?.length}>
        {enviando ? 'Enviando...' : 'Guardar E-14'}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Conteo rápido en vivo
// ---------------------------------------------------------------------------
function Conteo({ corporaciones }: { corporaciones: string[] }) {
  const [corporacion, setCorporacion] = useState(corporaciones.includes('GOBERNACION') ? 'GOBERNACION' : corporaciones[0]);
  const [municipioId, setMunicipioId] = useState('');
  const municipios = useQuery({ queryKey: ['municipios'], queryFn: api.municipios });
  const conteo = useQuery({
    queryKey: ['dia-d', 'conteo', corporacion, municipioId],
    queryFn: () => api.diaDConteo(corporacion, municipioId ? Number(municipioId) : undefined),
    refetchInterval: 20_000,
  });
  const d = conteo.data;
  const votosValidos = d?.opciones.filter((o) => o.tipo === 'CANDIDATO' || o.tipo === 'BLANCO').reduce((s, o) => s + Number(o.votos), 0) ?? 0;
  const grafico = (d?.opciones ?? [])
    .filter((o) => o.tipo === 'CANDIDATO' || o.tipo === 'BLANCO')
    .map((o) => ({ nombre: o.nombre, votos: Number(o.votos), propio: o.es_candidato_propio, pct: votosValidos ? (Number(o.votos) / votosValidos) * 100 : 0 }));
  const avance = d?.mesas ? (d.reportadas / d.mesas) * 100 : 0;

  return (
    <section className="dashboard-block">
      <div className="filtros-mapa">
        <label>
          Corporación
          <select value={corporacion} onChange={(e) => setCorporacion(e.target.value)}>
            {corporaciones.map((c) => (
              <option key={c} value={c}>
                {nombreCorporacion(c)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Zona
          <select value={municipioId} onChange={(e) => setMunicipioId(e.target.value)}>
            <option value="">Todo mi territorio</option>
            {municipios.data?.map((m) => (
              <option key={m.id} value={m.id}>
                {nombrePropio(m.nombre)}
              </option>
            ))}
          </select>
        </label>
        <p className="helper">
          Conteo propio con los E-14 que cargan los testigos. Se actualiza solo cada 20 segundos. No es el resultado oficial de la Registraduría.
        </p>
      </div>
      {conteo.isPending && <Cargando texto="Calculando..." />}
      {conteo.isError && <ErrorEstado mensaje={conteo.error.message} />}
      {d && (
        <>
          <div className="asistencia-cifras">
            <div>
              <strong>{avance.toFixed(1)} %</strong>
              <span>
                mesas reportadas ({numero(d.reportadas)} de {numero(d.mesas)})
              </span>
            </div>
            <div>
              <strong>{numero(d.validadas)}</strong>
              <span>E-14 validados</span>
            </div>
            <div>
              <strong>{numero(d.inconsistentes)}</strong>
              <span>con inconsistencias</span>
            </div>
            <div>
              <strong>{hora(d.ultimo_reporte)}</strong>
              <span>último reporte</span>
            </div>
          </div>
          <div className="barra-avance" role="progressbar" aria-valuenow={Math.round(avance)} aria-valuemin={0} aria-valuemax={100}>
            <span style={{ width: `${Math.min(100, avance)}%` }} />
          </div>
          {d.mesas === 0 ? (
            <div className="empty-inline">Todavía no hay mesas configuradas para esta jornada.</div>
          ) : (
            <>
              <div className="chart-box conteo-grafico">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={grafico} layout="vertical" margin={{ left: 10, right: 60 }}>
                    <CartesianGrid stroke="#e7eaef" horizontal={false} />
                    <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="nombre" width={160} tick={{ fontSize: 12 }} />
                    <Tooltip formatter={(v) => [numero(Number(v)), 'Votos']} />
                    <Bar dataKey="votos" radius={[0, 4, 4, 0]} barSize={22}>
                      {grafico.map((g) => (
                        <Cell key={g.nombre} fill={g.propio ? '#1c5cab' : '#9ec5f4'} />
                      ))}
                      <LabelList dataKey="pct" position="right" formatter={(v) => `${Number(v).toFixed(1)} %`} style={{ fontSize: 12, fill: '#0f1b2d' }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="table-wrap tabla-reporte">
                <table>
                  <thead>
                    <tr>
                      <th>Opción</th>
                      <th>Votos</th>
                      <th>% de válidos</th>
                      <th>Votos en E-14 validados</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.opciones.map((o) => (
                      <tr key={o.id} className={o.es_candidato_propio ? 'fila-propia' : ''}>
                        <td>
                          {o.nombre}
                          {o.partido && <small> · {o.partido}</small>}
                        </td>
                        <td>{numero(o.votos)}</td>
                        <td>{o.tipo === 'CANDIDATO' || o.tipo === 'BLANCO' ? `${(votosValidos ? (Number(o.votos) / votosValidos) * 100 : 0).toFixed(1)} %` : '—'}</td>
                        <td>{numero(o.votos_validados)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <h2 className="subtitulo-bloque">Por municipio</h2>
              <div className="table-wrap tabla-reporte">
                <table>
                  <thead>
                    <tr>
                      <th>Municipio</th>
                      <th>Mesas reportadas</th>
                      <th>Votos nuestros</th>
                      <th>% de los votos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.municipios.map((m) => (
                      <tr key={m.municipio_id}>
                        <td>{nombrePropio(m.nombre)}</td>
                        <td>
                          {numero(m.reportadas)} / {numero(m.mesas)}
                        </td>
                        <td>{numero(m.votos_propios)}</td>
                        <td>{m.votos_total ? `${((Number(m.votos_propios) / Number(m.votos_total)) * 100).toFixed(1)} %` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Testigos y mesas (coordinador y gerente)
// ---------------------------------------------------------------------------
function Testigos() {
  const { tienePermiso } = useSesion();
  const [municipioId, setMunicipioId] = useState('');
  const [puesto, setPuesto] = useState<PuestoDiaD>();
  const municipios = useQuery({ queryKey: ['municipios'], queryFn: api.municipios });
  const puestos = useQuery({ queryKey: ['dia-d', 'puestos', municipioId], queryFn: () => api.diaDPuestos(municipioId ? Number(municipioId) : undefined) });
  const totales = useMemo(
    () => (puestos.data ?? []).reduce((t, p) => ({ mesas: t.mesas + p.mesas, testigo: t.testigo + p.con_testigo }), { mesas: 0, testigo: 0 }),
    [puestos.data],
  );
  if (puesto) return <MesasPuesto puesto={puesto} onVolver={() => setPuesto(undefined)} />;

  return (
    <section className="dashboard-block">
      <div className="filtros-mapa">
        <label>
          Municipio
          <select value={municipioId} onChange={(e) => setMunicipioId(e.target.value)}>
            <option value="">Todo mi territorio</option>
            {municipios.data?.map((m) => (
              <option key={m.id} value={m.id}>
                {nombrePropio(m.nombre)}
              </option>
            ))}
          </select>
        </label>
        <p className="helper">
          {numero(totales.testigo)} de {numero(totales.mesas)} mesas tienen testigo. Los testigos son usuarios con el rol "Testigo electoral"
          {tienePermiso('USUARIO_GESTIONAR') ? (
            <>
              {' '}
              (créalos en <Link to="/usuarios">Usuarios</Link>).
            </>
          ) : (
            ' (los crea la gerencia).'
          )}
        </p>
      </div>
      {puestos.isPending && <Cargando />}
      {puestos.isError && <ErrorEstado mensaje={puestos.error.message} />}
      <div className="table-wrap tabla-reporte">
        <table>
          <thead>
            <tr>
              <th>Puesto</th>
              <th>Municipio</th>
              <th>Mesas</th>
              <th>Con testigo</th>
              <th>E-14 cargados</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {puestos.data?.map((p) => (
              <tr key={p.puesto_id} className={p.mesas > 0 && p.con_testigo < p.mesas ? 'fila-alerta' : ''}>
                <td>{nombrePropio(p.puesto)}</td>
                <td>{nombrePropio(p.municipio)}</td>
                <td>{p.mesas || 'Sin definir'}</td>
                <td>{p.mesas ? `${p.con_testigo} / ${p.mesas}` : '—'}</td>
                <td>{p.mesas ? `${p.e14_cargados} / ${p.mesas}` : '—'}</td>
                <td>
                  {p.mesas > 0 && (
                    <button type="button" className="link-button" onClick={() => setPuesto(p)}>
                      Asignar testigos
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function MesasPuesto({ puesto, onVolver }: { puesto: PuestoDiaD; onVolver: () => void }) {
  const cache = useQueryClient();
  const mesas = useQuery({ queryKey: ['dia-d', 'mesas', puesto.puesto_id], queryFn: () => api.diaDMesas(puesto.puesto_id) });
  const testigos = useQuery({ queryKey: ['dia-d', 'testigos'], queryFn: api.diaDTestigos });
  const [aviso, setAviso] = useState('');

  async function asignar(mesaId: number, usuarioId: string) {
    setAviso('');
    try {
      await api.diaDAsignarTestigo(mesaId, usuarioId || null);
      void cache.invalidateQueries({ queryKey: ['dia-d'] });
    } catch (causa) {
      setAviso(error(causa, 'No se pudo asignar el testigo.'));
    }
  }

  return (
    <section className="dashboard-block">
      <button type="button" className="back-link" onClick={onVolver}>
        ← Puestos
      </button>
      <h2>{nombrePropio(puesto.puesto)}</h2>
      <p className="helper">
        {nombrePropio(puesto.municipio)} · Un testigo puede cubrir varias mesas, pero todas del mismo puesto.
      </p>
      {aviso && <p className="form-error">{aviso}</p>}
      {mesas.isPending && <Cargando />}
      <div className="table-wrap tabla-reporte">
        <table>
          <thead>
            <tr>
              <th>Mesa</th>
              <th>Testigo</th>
              <th>E-14</th>
            </tr>
          </thead>
          <tbody>
            {mesas.data?.map((m) => (
              <tr key={m.mesa_id}>
                <td>Mesa {m.numero}</td>
                <td>
                  <select value={m.testigo_id ?? ''} onChange={(e) => void asignar(m.mesa_id, e.target.value)} aria-label={`Testigo de la mesa ${m.numero}`}>
                    <option value="">Sin testigo</option>
                    {testigos.data?.map((t) => (
                      <option key={t.usuario_id} value={t.usuario_id}>
                        {nombrePropio(t.nombre)} ({t.login}){t.puesto && t.usuario_id !== m.testigo_id ? ` · ya en ${nombrePropio(t.puesto)}` : ''}
                      </option>
                    ))}
                  </select>
                </td>
                <td>{m.formularios ? (m.estado_revision ?? '').split(',').map((s) => ESTADO_E14[s] ?? s).join(', ') : 'Sin cargar'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Revisión de E-14
// ---------------------------------------------------------------------------
function Revision() {
  const [estado, setEstado] = useState('');
  const revision = useQuery({ queryKey: ['dia-d', 'revision', estado], queryFn: () => api.diaDRevision({ estado: estado || undefined }), refetchInterval: 30_000 });
  return (
    <section className="dashboard-block">
      <div className="segmented" role="group" aria-label="Estado">
        {[
          ['', 'Todos'],
          ['CON_INCONSISTENCIAS', 'Con inconsistencias'],
          ['PENDIENTE', 'Por revisar'],
          ['VALIDADO', 'Validados'],
        ].map(([v, e]) => (
          <button key={v} type="button" className={estado === v ? 'active' : ''} onClick={() => setEstado(v)}>
            {e}
          </button>
        ))}
      </div>
      {revision.isPending && <Cargando />}
      {revision.isError && <ErrorEstado mensaje={revision.error.message} />}
      {revision.data?.length === 0 && <div className="empty-inline">No hay formularios en este estado.</div>}
      <ul className="solicitudes-lider">
        {revision.data?.map((f) => (
          <FormularioE14 key={f.formulario_id} f={f} />
        ))}
      </ul>
    </section>
  );
}

function FormularioE14({ f }: { f: FormularioRevision }) {
  const cache = useQueryClient();
  const [foto, setFoto] = useState<string>();
  const [observacion, setObservacion] = useState(f.observacion ?? '');
  const [aviso, setAviso] = useState('');

  async function verFoto() {
    try {
      setFoto(await api.diaDFotoE14(f.formulario_id));
    } catch (causa) {
      setAviso(error(causa, 'No se pudo cargar la foto.'));
    }
  }

  async function revisar(estado: string) {
    setAviso('');
    try {
      await api.diaDRevisar(f.formulario_id, estado, observacion);
      void cache.invalidateQueries({ queryKey: ['dia-d'] });
    } catch (causa) {
      setAviso(error(causa, 'No se pudo guardar la revisión.'));
    }
  }

  return (
    <li>
      <div className="solicitud-datos">
        <strong>
          {nombrePropio(f.puesto)} · Mesa {f.mesa}{' '}
          <span className={`estado-pill ${f.estado_revision === 'VALIDADO' ? 'estado-bien' : 'estado-aviso'}`}>{ESTADO_E14[f.estado_revision]}</span>
        </strong>
        <span>
          {nombrePropio(f.municipio)} · {nombreCorporacion(f.corporacion)} · cargado {hora(f.cargado_en)} por {f.cargado_por} · total {numero(f.total_votos)}
        </span>
        <dl>
          {f.votos?.map((v) => (
            <div key={v.opcion}>
              <dt>{v.opcion}</dt>
              <dd>{numero(v.votos)}</dd>
            </div>
          ))}
        </dl>
        {foto ? (
          <a href={foto} target="_blank" rel="noopener" className="e14-miniatura">
            <img src={foto} alt={`E-14 de la mesa ${f.mesa}`} />
          </a>
        ) : (
          <button type="button" className="link-button" onClick={() => void verFoto()}>
            Ver foto del E-14
          </button>
        )}
        <label>
          Observación
          <input value={observacion} onChange={(e) => setObservacion(e.target.value)} maxLength={500} placeholder="Por ejemplo: tachón en los votos del candidato" />
        </label>
        {aviso && <p className="form-error">{aviso}</p>}
      </div>
      <div className="solicitud-acciones columna">
        {f.estado_revision !== 'VALIDADO' && (
          <button type="button" className="primary-button" onClick={() => void revisar('VALIDADO')}>
            Validar
          </button>
        )}
        {f.estado_revision !== 'CON_INCONSISTENCIAS' && (
          <button type="button" className="secondary-button boton-peligro" onClick={() => void revisar('CON_INCONSISTENCIAS')}>
            Marcar inconsistente
          </button>
        )}
        {f.estado_revision === 'VALIDADO' && (
          <button type="button" className="secondary-button" onClick={() => void revisar('PENDIENTE')}>
            Reabrir
          </button>
        )}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Configuración (gerente): jornada, candidatos y mesas
// ---------------------------------------------------------------------------
function Configuracion({ corporaciones }: { corporaciones: string[] }) {
  const cache = useQueryClient();
  const jornadas = useQuery({ queryKey: ['dia-d', 'jornadas'], queryFn: api.diaDJornadas });
  const [corporacion, setCorporacion] = useState(corporaciones.includes('GOBERNACION') ? 'GOBERNACION' : corporaciones[0]);
  const opciones = useQuery({ queryKey: ['dia-d', 'opciones', corporacion], queryFn: () => api.diaDOpciones(corporacion) });
  const puestos = useQuery({ queryKey: ['dia-d', 'puestos', ''], queryFn: () => api.diaDPuestos() });
  const [nueva, setNueva] = useState({ nombre: 'Territoriales 2027', tipo: 'TERRITORIAL', fecha: '2027-10-31' });
  const [candidato, setCandidato] = useState({ nombre: '', partido: '', propio: false });
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string }>();
  const refrescar = () => void cache.invalidateQueries({ queryKey: ['dia-d'] });
  const activa = jornadas.data?.find((j) => j.activa);

  async function accion(f: () => Promise<unknown>, ok: string) {
    setAviso(undefined);
    try {
      await f();
      setAviso({ ok: true, texto: ok });
      refrescar();
    } catch (causa) {
      setAviso({ ok: false, texto: error(causa, 'No se pudo guardar.') });
    }
  }

  return (
    <>
      {aviso && <p className={aviso.ok ? 'form-success' : 'form-error'}>{aviso.texto}</p>}
      <section className="dashboard-block">
        <h2>Jornada electoral</h2>
        <p className="helper">
          Jornada activa: <strong>{activa ? `${activa.nombre} (${activa.fecha})` : 'ninguna'}</strong>. Al crear una nueva se copian los puestos de la
          activa y la nueva queda activa.
        </p>
        <form
          className="inline-form fila-formulario"
          onSubmit={(e) => {
            e.preventDefault();
            void accion(() => api.diaDCrearJornada({ ...nueva, copiarDe: activa?.id ?? 1 }), 'Jornada creada y activada.');
          }}
        >
          <label>
            Nombre
            <input value={nueva.nombre} onChange={(e) => setNueva({ ...nueva, nombre: e.target.value })} required minLength={3} />
          </label>
          <label>
            Fecha
            <input type="date" value={nueva.fecha} onChange={(e) => setNueva({ ...nueva, fecha: e.target.value })} required />
          </label>
          <button className="secondary-button">Crear jornada nueva</button>
        </form>
      </section>

      <section className="dashboard-block">
        <div className="block-heading">
          <h2>Tarjetón</h2>
          <select value={corporacion} onChange={(e) => setCorporacion(e.target.value)} aria-label="Corporación">
            {corporaciones.map((c) => (
              <option key={c} value={c}>
                {nombreCorporacion(c)}
              </option>
            ))}
          </select>
        </div>
        <ul className="lista-simple">
          {opciones.data?.map((o: OpcionVoto) => (
            <li key={o.id}>
              <span>
                {o.nombre}
                {o.partido && <small> · {o.partido}</small>}
                {o.es_candidato_propio && <span className="estado-pill estado-bien">Nuestro candidato</span>}
              </span>
              {o.tipo === 'CANDIDATO' && (
                <button type="button" className="link-button" onClick={() => void accion(() => api.diaDQuitarCandidato(o.id), 'Candidato quitado.')}>
                  Quitar
                </button>
              )}
            </li>
          ))}
        </ul>
        <form
          className="inline-form fila-formulario"
          onSubmit={(e) => {
            e.preventDefault();
            void accion(async () => {
              await api.diaDGuardarCandidato({ corporacion, nombre: candidato.nombre, partido: candidato.partido || undefined, propio: candidato.propio });
              setCandidato({ nombre: '', partido: '', propio: false });
            }, 'Candidato agregado.');
          }}
        >
          <label>
            Candidato
            <input value={candidato.nombre} onChange={(e) => setCandidato({ ...candidato, nombre: e.target.value })} required minLength={3} />
          </label>
          <label>
            Partido
            <input value={candidato.partido} onChange={(e) => setCandidato({ ...candidato, partido: e.target.value })} />
          </label>
          <label className="checkbox-label">
            <input type="checkbox" checked={candidato.propio} onChange={(e) => setCandidato({ ...candidato, propio: e.target.checked })} />
            Es nuestro candidato
          </label>
          <button className="secondary-button">Agregar</button>
        </form>
      </section>

      <section className="dashboard-block">
        <h2>Mesas por puesto</h2>
        <p className="helper">
          Número de mesas de cada puesto según el Divipole de la Registraduría. Se pueden cargar todas a la vez con el script de la guía (docs/dia-d.md).
        </p>
        {puestos.isPending && <Cargando />}
        <div className="table-wrap tabla-reporte">
          <table>
            <thead>
              <tr>
                <th>Puesto</th>
                <th>Municipio</th>
                <th>Mesas</th>
              </tr>
            </thead>
            <tbody>
              {puestos.data?.map((p) => (
                <tr key={p.puesto_id}>
                  <td>{nombrePropio(p.puesto)}</td>
                  <td>{nombrePropio(p.municipio)}</td>
                  <td>
                    <input
                      className="input-mesas"
                      type="number"
                      min={0}
                      max={200}
                      defaultValue={p.mesas}
                      aria-label={`Mesas de ${p.puesto}`}
                      onBlur={(e) => {
                        const n = Number(e.target.value);
                        if (n !== p.mesas) void accion(() => api.diaDDefinirMesas(p.puesto_id, n), `${nombrePropio(p.puesto)}: ${n} mesas.`);
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

export function SinAccesoPage() {
  return (
    <main className="page-content">
      <section className="state-card">
        <Icono nombre="candado" tamano={26} />
        <strong>Tu usuario no tiene pantallas asignadas</strong>
        <span>Pide a la coordinación de la campaña que revise tu rol.</span>
      </section>
    </main>
  );
}
