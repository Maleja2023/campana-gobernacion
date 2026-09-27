import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type MiembroRed, type RolAsignable, type UsuarioFila } from '../api/cliente';
import { Cargando, ErrorEstado } from '../componentes/Estados';
import { useSesion } from '../sesion/SesionContext';

const POR_PAGINA = 20;

function formatFecha(v: string | null) {
  if (!v) return 'Nunca';
  return new Date(v).toLocaleDateString('es-CO', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function UsuariosPage() {
  const { usuario } = useSesion();
  const cache = useQueryClient();
  const [texto, setTexto] = useState('');
  const [textoAplicado, setTextoAplicado] = useState('');
  const [activo, setActivo] = useState<'' | 'true' | 'false'>('');
  const [pagina, setPagina] = useState(1);
  const [creandoAbierto, setCreandoAbierto] = useState(false);
  const [error, setError] = useState('');
  const [claveRevelada, setClaveRevelada] = useState<{ login: string; clave: string }>();

  const roles = useQuery({ queryKey: ['usuarios-roles'], queryFn: api.rolesAsignables });
  const miembros = useQuery({ queryKey: ['red-arbol'], queryFn: api.redArbol, enabled: creandoAbierto });
  const lista = useQuery({
    queryKey: ['usuarios-lista', textoAplicado, activo, pagina],
    queryFn: () => api.usuarios({ texto: textoAplicado || undefined, activo: activo === '' ? undefined : activo === 'true', pagina, porPagina: POR_PAGINA }),
  });

  function buscar(e: FormEvent) {
    e.preventDefault();
    setPagina(1);
    setTextoAplicado(texto.trim());
  }

  async function refrescar() {
    await cache.invalidateQueries({ queryKey: ['usuarios-lista'] });
  }

  async function alternarActivo(u: UsuarioFila) {
    setError('');
    try {
      await api.actualizarUsuario(u.id, { activo: !u.activo });
      await refrescar();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No fue posible cambiar el estado.');
    }
  }

  async function restablecerClave(u: UsuarioFila) {
    if (!window.confirm(`¿Restablecer la contraseña de ${u.login}? La contraseña actual dejará de servir.`)) return;
    setError('');
    try {
      const { claveTemporal } = await api.restablecerClave(u.id);
      setClaveRevelada({ login: u.login, clave: claveTemporal });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No fue posible restablecer la contraseña.');
    }
  }

  async function restablecerMfa(u: UsuarioFila) {
    if (!window.confirm(`¿Restablecer el doble factor de ${u.login}? Deberá configurarlo de nuevo al iniciar sesión.`)) return;
    setError('');
    try {
      await api.restablecerMfa(u.id);
      await refrescar();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No fue posible restablecer el doble factor.');
    }
  }

  return (
    <main className="page-content usuarios-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Administración</p>
          <h1>Usuarios</h1>
        </div>
        <button type="button" className="secondary-button" onClick={() => setCreandoAbierto(!creandoAbierto)}>
          {creandoAbierto ? 'Cancelar' : 'Crear usuario'}
        </button>
      </div>

      {claveRevelada && (
        <ClaveRevelada
          login={claveRevelada.login}
          clave={claveRevelada.clave}
          onClose={() => setClaveRevelada(undefined)}
        />
      )}

      {creandoAbierto && (
        <CrearUsuarioForm
          roles={roles.data ?? []}
          miembros={miembros.data ?? []}
          onDone={async () => {
            setCreandoAbierto(false);
            await refrescar();
          }}
        />
      )}

      <form className="filter-row" onSubmit={buscar}>
        <label>
          Buscar
          <input type="search" placeholder="Login, nombres o apellidos" value={texto} onChange={(e) => setTexto(e.target.value)} />
        </label>
        <label>
          Estado
          <select
            value={activo}
            onChange={(e) => {
              setPagina(1);
              setActivo(e.target.value as typeof activo);
            }}
          >
            <option value="">Todos</option>
            <option value="true">Activos</option>
            <option value="false">Inactivos</option>
          </select>
        </label>
        <button type="submit" className="secondary-button">
          Buscar
        </button>
      </form>

      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}

      {lista.isPending && <Cargando texto="Cargando usuarios..." />}
      {lista.isError && <ErrorEstado mensaje={lista.error.message} reintentar={() => void lista.refetch()} />}
      {lista.data && (
        <div className="dashboard-block">
          <div className="table-wrap">
            <table>
              <caption className="sr-only">Listado de usuarios</caption>
              <thead>
                <tr>
                  <th>Login</th>
                  <th>Nombre</th>
                  <th>Roles</th>
                  <th>Territorios</th>
                  <th>Último ingreso</th>
                  <th>Estado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {lista.data.datos.map((u) => (
                  <tr key={u.id}>
                    <td>{u.login}</td>
                    <td>
                      {u.nombres} {u.apellidos}
                    </td>
                    <td>{u.roles.map((r) => r.nombre).join(', ') || '—'}</td>
                    <td>{u.territorios.map((t) => t.nombre).join(', ') || '—'}</td>
                    <td>{formatFecha(u.ultimo_ingreso)}</td>
                    <td>
                      <span className={`estado-pill ${u.activo ? 'estado-activo' : 'estado-retirado'}`}>{u.activo ? 'Activo' : 'Inactivo'}</span>
                    </td>
                    <td>
                      {u.id === usuario?.id ? (
                        <small>Tu propia cuenta</small>
                      ) : (
                        <div className="row-actions">
                          <button type="button" className="link-button" onClick={() => void alternarActivo(u)}>
                            {u.activo ? 'Desactivar' : 'Activar'}
                          </button>
                          <button type="button" className="link-button" onClick={() => void restablecerClave(u)}>
                            Restablecer contraseña
                          </button>
                          <button type="button" className="link-button danger" onClick={() => void restablecerMfa(u)}>
                            Restablecer doble factor
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {lista.data.datos.length === 0 && (
                  <tr>
                    <td colSpan={7}>No se encontraron usuarios con estos filtros.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="pager">
            <button type="button" disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)}>
              Anterior
            </button>
            <span>
              Página {pagina} · {lista.data.total} en total
            </span>
            <button type="button" disabled={pagina * POR_PAGINA >= lista.data.total} onClick={() => setPagina(pagina + 1)}>
              Siguiente
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

/** La clave temporal solo se muestra esta vez: ni la API ni la pantalla la vuelven a revelar. */
function ClaveRevelada({ login, clave, onClose }: { login: string; clave: string; onClose: () => void }) {
  const [copiado, setCopiado] = useState(false);
  async function copiar() {
    try {
      await navigator.clipboard.writeText(clave);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      /* el usuario puede copiarla manualmente del texto visible */
    }
  }
  return (
    <div className="dashboard-block success-chat" role="alertdialog" aria-label="Contraseña temporal">
      <strong>Contraseña temporal para {login}</strong>
      <p>
        Esta es la ÚNICA vez que se muestra. Compártela por un medio seguro; el usuario deberá cambiarla al iniciar sesión.
      </p>
      <p className="temporal-password">{clave}</p>
      <div className="form-actions">
        <button type="button" className="secondary-button" onClick={() => void copiar()}>
          {copiado ? 'Copiada' : 'Copiar'}
        </button>
        <button type="button" className="primary-button" onClick={onClose}>
          Ya la guardé, cerrar
        </button>
      </div>
    </div>
  );
}

function CrearUsuarioForm({ roles, miembros, onDone }: { roles: RolAsignable[]; miembros: MiembroRed[]; onDone: () => void | Promise<void> }) {
  const [modo, setModo] = useState<'nueva' | 'existente'>('nueva');
  const [login, setLogin] = useState('');
  const [documento, setDocumento] = useState('');
  const [nombres, setNombres] = useState('');
  const [apellidos, setApellidos] = useState('');
  const [miembroId, setMiembroId] = useState('');
  const [rolesElegidos, setRolesElegidos] = useState<string[]>([]);
  const [texto, setTexto] = useState('');
  const [resultados, setResultados] = useState<{ id: number; nombre: string; tipo: string }[]>([]);
  const [territorios, setTerritorios] = useState<{ id: number; nombre: string }[]>([]);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [exito, setExito] = useState<{ login: string; claveTemporal: string }>();

  function alternarRol(codigo: string) {
    setRolesElegidos((actual) => (actual.includes(codigo) ? actual.filter((r) => r !== codigo) : [...actual, codigo]));
  }

  async function buscarTerritorio(valor: string) {
    setTexto(valor);
    setResultados(valor.length >= 3 ? await api.buscarTerritorio(valor) : []);
  }

  function agregarTerritorio(t: { id: number; nombre: string }) {
    if (territorios.some((x) => x.id === t.id)) return;
    setTerritorios([...territorios, t]);
    setResultados([]);
    setTexto('');
  }

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setError('');
    setGuardando(true);
    try {
      const res = await api.crearUsuario({
        login: login.trim(),
        roles: rolesElegidos,
        territorioIds: territorios.map((t) => t.id),
        miembroId: modo === 'existente' ? miembroId : undefined,
        documento: modo === 'nueva' ? documento : undefined,
        nombres: modo === 'nueva' ? nombres.trim() : undefined,
        apellidos: modo === 'nueva' ? apellidos.trim() : undefined,
      });
      setExito({ login: res.login, claveTemporal: res.claveTemporal });
      await onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No fue posible crear el usuario.');
    } finally {
      setGuardando(false);
    }
  }

  if (exito) {
    return (
      <div className="dashboard-block success-chat">
        <strong>Usuario creado: {exito.login}</strong>
        <p>Contraseña temporal (solo se muestra esta vez):</p>
        <p className="temporal-password">{exito.claveTemporal}</p>
      </div>
    );
  }

  return (
    <form className="dashboard-block visit-form" onSubmit={guardar}>
      <h2>Crear usuario</h2>
      <div className="choice-list" role="radiogroup" aria-label="Origen de la persona">
        <button type="button" className={modo === 'nueva' ? 'selected' : ''} onClick={() => setModo('nueva')}>
          Persona nueva
        </button>
        <button type="button" className={modo === 'existente' ? 'selected' : ''} onClick={() => setModo('existente')}>
          Desde un miembro existente (por su ID)
        </button>
      </div>
      {modo === 'nueva' ? (
        <>
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
        </>
      ) : (
        <label>
          Miembro de la estructura
          <select value={miembroId} onChange={(e) => setMiembroId(e.target.value)} required>
            <option value="">Selecciona uno</option>
            {miembros.map((m) => (
              <option key={m.miembro_id} value={m.miembro_id}>
                {m.nombre}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        Login (correo)
        <input type="email" value={login} onChange={(e) => setLogin(e.target.value)} required />
      </label>
      <fieldset className="choice-list">
        <legend>Roles</legend>
        {roles.map((r) => (
          <button key={r.codigo} type="button" className={rolesElegidos.includes(r.codigo) ? 'selected' : ''} onClick={() => alternarRol(r.codigo)} title={r.descripcion}>
            {r.nombre}
          </button>
        ))}
      </fieldset>
      <div className="territorio-editor">
        <label>
          Agregar territorio <span className="optional">necesario para coordinadores</span>
          <input placeholder="Escribe el nombre" value={texto} onChange={(e) => void buscarTerritorio(e.target.value)} />
        </label>
        {resultados.length > 0 && (
          <div className="choice-list">
            {resultados.map((t) => (
              <button type="button" key={t.id} onClick={() => agregarTerritorio({ id: t.id, nombre: t.nombre })}>
                {t.nombre}
              </button>
            ))}
          </div>
        )}
        {territorios.length > 0 && (
          <ul className="legend-municipios-list">
            {territorios.map((t) => (
              <li key={t.id}>
                {t.nombre}{' '}
                <button type="button" className="link-button" onClick={() => setTerritorios(territorios.filter((x) => x.id !== t.id))}>
                  Quitar
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      <div className="form-actions">
        <button type="submit" className="primary-button" disabled={guardando || rolesElegidos.length === 0}>
          {guardando ? 'Creando...' : 'Crear usuario'}
        </button>
      </div>
    </form>
  );
}
