import { type FormEvent, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Simpatizante, type TerritorioCatalogo } from '../api/cliente';
import { Cargando, ErrorEstado } from '../componentes/Estados';
import { useSesion } from '../sesion/SesionContext';

const POR_PAGINA = 20;

const ESTADOS: { codigo: string; etiqueta: string }[] = [
  { codigo: 'ACTIVO', etiqueta: 'Activo' },
  { codigo: 'EN_REVISION', etiqueta: 'En revisión' },
  { codigo: 'RETIRADO', etiqueta: 'Retirado' },
];

function etiquetaEstado(codigo: string | null) {
  return ESTADOS.find((e) => e.codigo === codigo)?.etiqueta ?? codigo ?? '—';
}

function formatFecha(v: string | null) {
  if (!v) return '—';
  return new Date(v).toLocaleDateString('es-CO', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function SimpatizantesPage() {
  const { tienePermiso } = useSesion();
  const puedeEditar = tienePermiso('SIMPATIZANTE_EDITAR');
  const puedeExportar = tienePermiso('EXPORTAR');
  const cache = useQueryClient();

  const [texto, setTexto] = useState('');
  const [textoAplicado, setTextoAplicado] = useState('');
  const [estado, setEstado] = useState('');
  const [municipioId, setMunicipioId] = useState('');
  const [pagina, setPagina] = useState(1);
  const [editando, setEditando] = useState<Simpatizante | null>(null);
  const [retirando, setRetirando] = useState<string>();
  const [exportando, setExportando] = useState(false);
  const [errorAccion, setErrorAccion] = useState('');

  const municipios = useQuery({ queryKey: ['municipios'], queryFn: api.municipios });
  const lista = useQuery({
    queryKey: ['simpatizantes-lista', textoAplicado, estado, municipioId, pagina],
    queryFn: () =>
      api.listarSimpatizantes({
        texto: textoAplicado || undefined,
        estado: estado || undefined,
        municipioId: municipioId ? Number(municipioId) : undefined,
        pagina,
        porPagina: POR_PAGINA,
      }),
  });

  function buscar(e: FormEvent) {
    e.preventDefault();
    cambiarFiltro(() => setTextoAplicado(texto.trim()));
  }

  function irAPagina(n: number) {
    setErrorAccion('');
    setPagina(n);
  }

  async function refrescar() {
    await cache.invalidateQueries({ queryKey: ['simpatizantes-lista'] });
  }

  async function retirar(s: Simpatizante) {
    if (s.estado_codigo === 'RETIRADO') return;
    const nombre = `${s.nombres ?? ''} ${s.apellidos ?? ''}`.trim();
    if (!window.confirm(`¿Retirar a ${nombre} de la campaña?`)) return;
    setErrorAccion('');
    setRetirando(s.persona_id);
    try {
      await api.retirarSimpatizante(s.persona_id);
      await refrescar();
    } catch (cause) {
      setErrorAccion(cause instanceof Error ? cause.message : 'No fue posible retirar a la persona.');
    } finally {
      setRetirando(undefined);
    }
  }

  function cambiarFiltro(fn: () => void) {
    setErrorAccion('');
    setPagina(1);
    fn();
  }

  async function exportar() {
    const motivo = window.prompt('¿Por qué exportas esta lista? Quedará registrado con tu usuario y la fecha.');
    if (motivo === null) return;
    const nota = motivo.trim();
    if (nota.length < 5 || nota.length > 500) {
      setErrorAccion('El motivo debe tener entre 5 y 500 caracteres.');
      return;
    }
    setErrorAccion('');
    setExportando(true);
    try {
      const blob = await api.exportarSimpatizantes({
        motivo: nota,
        texto: textoAplicado || undefined,
        estado: estado || undefined,
        municipioId: municipioId ? Number(municipioId) : undefined,
      });
      const url = URL.createObjectURL(blob);
      const enlace = document.createElement('a');
      enlace.href = url;
      enlace.download = 'simpatizantes.xlsx';
      document.body.appendChild(enlace);
      enlace.click();
      enlace.remove();
      // Diferido: revocar en el mismo tick puede cortar la descarga en algunos navegadores.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      setErrorAccion(cause instanceof Error ? cause.message : 'No fue posible exportar la lista.');
    } finally {
      setExportando(false);
    }
  }

  return (
    <main className="page-content simpatizantes-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Estructura de campaña</p>
          <h1>Simpatizantes</h1>
        </div>
        {puedeExportar && (
          <button type="button" className="secondary-button" disabled={exportando} onClick={() => void exportar()}>
            {exportando ? 'Exportando...' : 'Exportar a Excel'}
          </button>
        )}
      </div>

      <form className="filter-row" onSubmit={buscar}>
        <label>
          Buscar
          <input type="search" placeholder="Nombre o apellido" value={texto} onChange={(e) => setTexto(e.target.value)} />
        </label>
        <label>
          Estado
          <select value={estado} onChange={(e) => cambiarFiltro(() => setEstado(e.target.value))}>
            <option value="">Todos</option>
            {ESTADOS.map((e) => (
              <option key={e.codigo} value={e.codigo}>
                {e.etiqueta}
              </option>
            ))}
          </select>
        </label>
        <label>
          Municipio
          <select value={municipioId} onChange={(e) => cambiarFiltro(() => setMunicipioId(e.target.value))}>
            <option value="">Todos</option>
            {municipios.data?.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nombre}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="secondary-button">
          Buscar
        </button>
      </form>

      {errorAccion && (
        <div className="form-error" role="alert">
          {errorAccion}
        </div>
      )}

      {editando && (
        <EditarSimpatizanteForm
          simpatizante={editando}
          municipios={municipios.data ?? []}
          onCancel={() => setEditando(null)}
          onDone={async () => {
            setEditando(null);
            await refrescar();
          }}
        />
      )}

      {lista.isPending && <Cargando texto="Cargando simpatizantes..." />}
      {lista.isError && <ErrorEstado mensaje={lista.error.message} reintentar={() => void lista.refetch()} />}
      {lista.data && (
        <div className="dashboard-block">
          <div className="table-wrap">
            <table>
              <caption className="sr-only">Listado de simpatizantes</caption>
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Territorio</th>
                  <th>Estado</th>
                  <th>Registrado</th>
                  {puedeEditar && <th>Acciones</th>}
                </tr>
              </thead>
              <tbody>
                {lista.data.datos.map((s) => (
                  <tr key={s.persona_id}>
                    <td>
                      {s.nombres} {s.apellidos}
                    </td>
                    <td>
                      {s.territorio_residencia}
                      {s.municipio && s.municipio !== s.territorio_residencia ? ` · ${s.municipio}` : ''}
                    </td>
                    <td>
                      <span className={`estado-pill estado-${(s.estado_codigo ?? '').toLowerCase()}`}>{etiquetaEstado(s.estado_codigo)}</span>
                    </td>
                    <td>{formatFecha(s.capturado_en)}</td>
                    {puedeEditar && (
                      <td>
                        <div className="row-actions">
                          <button type="button" className="link-button" aria-label={`Editar a ${s.nombres} ${s.apellidos}`} onClick={() => setEditando(s)}>
                            Editar
                          </button>
                          <button
                            type="button"
                            className="link-button danger"
                            aria-label={`Retirar a ${s.nombres} ${s.apellidos}`}
                            disabled={s.estado_codigo === 'RETIRADO' || retirando === s.persona_id}
                            onClick={() => void retirar(s)}
                          >
                            {retirando === s.persona_id ? 'Retirando...' : 'Retirar'}
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
                {lista.data.datos.length === 0 && (
                  <tr>
                    <td colSpan={puedeEditar ? 5 : 4}>No se encontraron simpatizantes con estos filtros.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="pager">
            <button type="button" disabled={pagina <= 1} onClick={() => irAPagina(pagina - 1)}>
              Anterior
            </button>
            <span>
              Página {pagina} · {lista.data.total} en total
            </span>
            <button type="button" disabled={pagina * POR_PAGINA >= lista.data.total} onClick={() => irAPagina(pagina + 1)}>
              Siguiente
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

function EditarSimpatizanteForm({
  simpatizante,
  municipios,
  onCancel,
  onDone,
}: {
  simpatizante: Simpatizante;
  municipios: TerritorioCatalogo[];
  onCancel: () => void;
  onDone: () => void | Promise<void>;
}) {
  const [nombres, setNombres] = useState(simpatizante.nombres ?? '');
  const [apellidos, setApellidos] = useState(simpatizante.apellidos ?? '');
  const [telefono, setTelefono] = useState('');
  const [municipioBusqueda, setMunicipioBusqueda] = useState('');
  const [textoBusqueda, setTextoBusqueda] = useState('');
  const [resultados, setResultados] = useState<{ id: number; tipo: string; nombre: string; municipio: string | null }[]>([]);
  const [territorioId, setTerritorioId] = useState('');
  const [territorioNombre, setTerritorioNombre] = useState('');
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  async function buscarTerritorio(texto: string) {
    setTextoBusqueda(texto);
    setResultados(texto.length >= 3 ? await api.buscarTerritorio(texto, municipioBusqueda ? Number(municipioBusqueda) : undefined) : []);
  }

  function elegirTerritorio(id: string, nombre: string) {
    setTerritorioId(id);
    setTerritorioNombre(nombre);
  }

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setError('');
    setGuardando(true);
    try {
      await api.editarSimpatizante(simpatizante.persona_id, {
        nombres: nombres.trim(),
        apellidos: apellidos.trim(),
        telefono: telefono || undefined,
        territorioId: territorioId ? Number(territorioId) : undefined,
      });
      await onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No fue posible guardar los cambios.');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form className="dashboard-block visit-form" onSubmit={guardar}>
      <h2>
        Editar a {simpatizante.nombres} {simpatizante.apellidos}
      </h2>
      <div className="form-columns">
        <label>
          Nombres
          <input autoFocus value={nombres} onChange={(e) => setNombres(e.target.value)} minLength={2} required />
        </label>
        <label>
          Apellidos
          <input value={apellidos} onChange={(e) => setApellidos(e.target.value)} minLength={2} required />
        </label>
      </div>
      <label>
        Celular <span className="optional">deja vacío para no cambiarlo</span>
        <input inputMode="tel" pattern="3[0-9]{9}" value={telefono} onChange={(e) => setTelefono(e.target.value.replace(/\D/g, ''))} />
      </label>
      <div className="territorio-editor">
        <label>
          Cambiar territorio de residencia <span className="optional">deja "No cambiar" para conservar el actual</span>
          <select
            value={municipioBusqueda}
            onChange={(e) => {
              setMunicipioBusqueda(e.target.value);
              setTextoBusqueda('');
              setResultados([]);
              setTerritorioId('');
              setTerritorioNombre('');
            }}
          >
            <option value="">No cambiar</option>
            {municipios.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nombre}
              </option>
            ))}
          </select>
        </label>
        {municipioBusqueda && (
          <>
            <label>
              Busca su vereda o barrio dentro de ese municipio <span className="optional">opcional</span>
              <input placeholder="Escribe el nombre" value={textoBusqueda} onChange={(e) => void buscarTerritorio(e.target.value)} />
            </label>
            <div className="choice-list">
              {resultados.map((t) => (
                <button
                  type="button"
                  key={t.id}
                  className={territorioId === String(t.id) ? 'selected' : ''}
                  onClick={() => elegirTerritorio(String(t.id), t.nombre)}
                >
                  {t.nombre}
                </button>
              ))}
              <button
                type="button"
                className={territorioId === municipioBusqueda ? 'selected' : ''}
                onClick={() => elegirTerritorio(municipioBusqueda, municipios.find((m) => String(m.id) === municipioBusqueda)?.nombre ?? 'el municipio')}
              >
                Dejarlo a nivel de municipio (sin vereda/barrio específico)
              </button>
            </div>
            {territorioId && (
              <p className="territorio-elegido">
                Se guardará: <strong>{territorioNombre}</strong>
              </p>
            )}
          </>
        )}
      </div>
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      <div className="form-actions">
        <button type="submit" className="primary-button" disabled={guardando}>
          {guardando ? 'Guardando...' : 'Guardar cambios'}
        </button>
        <button type="button" className="secondary-button" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
