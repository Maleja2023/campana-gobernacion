import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { Icono, type NombreIcono } from '../componentes/Icono';
import { usePendientes } from '../offline/usePendientes';
import { useSesion } from '../sesion/SesionContext';
import { nombrePropio } from '../util/nombres';

type Opcion = { etiqueta: string; ruta: string; permiso: string; icono: NombreIcono };

const SECCIONES: { titulo: string; opciones: Opcion[] }[] = [
  {
    titulo: 'Seguimiento',
    opciones: [
      { etiqueta: 'Tablero', ruta: '/tablero', permiso: 'REPORTE_VER', icono: 'tablero' },
      { etiqueta: 'Reportes', ruta: '/reportes', permiso: 'REPORTE_VER', icono: 'reporte' },
      { etiqueta: 'Mapa territorial', ruta: '/mapa', permiso: 'MAPA_VER', icono: 'mapa' },
      { etiqueta: 'Simpatizantes', ruta: '/simpatizantes', permiso: 'SIMPATIZANTE_VER', icono: 'personas' },
      { etiqueta: 'Alertas de calidad', ruta: '/alertas', permiso: 'ALERTA_GESTIONAR', icono: 'alerta' },
    ],
  },
  {
    titulo: 'Territorio',
    opciones: [
      { etiqueta: 'Agenda territorial', ruta: '/agenda', permiso: 'AGENDA_VER', icono: 'agenda' },
      { etiqueta: 'Voz del territorio', ruta: '/necesidades', permiso: 'REPORTE_VER', icono: 'chispa' },
      { etiqueta: 'Reportar necesidad', ruta: '/reportar', permiso: 'REPORTE_COMUNITARIO', icono: 'necesidad' },
      { etiqueta: 'Día de elecciones', ruta: '/dia-d', permiso: 'E14_CARGAR', icono: 'calendario' },
    ],
  },
  {
    titulo: 'Organización',
    opciones: [
      { etiqueta: 'Mi red', ruta: '/red', permiso: 'REPORTE_VER', icono: 'red' },
      { etiqueta: 'Registrar simpatizante', ruta: '/registrar', permiso: 'SIMPATIZANTE_CREAR', icono: 'mas' },
      { etiqueta: 'Usuarios', ruta: '/usuarios', permiso: 'USUARIO_GESTIONAR', icono: 'usuario' },
    ],
  },
];

const ROLES: Record<string, string> = {
  SUPERADMIN: 'Superadministrador',
  CANDIDATO: 'Candidato',
  GERENTE: 'Gerente de campaña',
  COORDINADOR: 'Coordinador municipal',
  LIDER: 'Líder',
  DIGITADOR: 'Digitador',
  TESTIGO: 'Testigo electoral',
};

function iniciales(nombre: string) {
  const partes = nombre.trim().split(/\s+/);
  return ((partes[0]?.[0] ?? '') + (partes[1]?.[0] ?? '')).toUpperCase();
}

export function AppLayout() {
  const [abierto, setAbierto] = useState(false);
  const { usuario, tienePermiso, cerrar, avisoInactividad } = useSesion();
  const navigate = useNavigate();
  // Envía solos los registros guardados sin conexión, desde cualquier pantalla.
  const { pendientes, enLinea } = usePendientes(usuario?.id, { enviarSolo: true });
  const nombre = nombrePropio(`${usuario?.nombres ?? ''} ${usuario?.apellidos ?? ''}`.trim());
  const rol = usuario?.roles.map((r) => ROLES[r] ?? nombrePropio(r.replaceAll('_', ' '))).join(', ') || 'Usuario';
  const territorio = usuario?.territorios[0] ? nombrePropio(usuario.territorios[0].nombre) : null;
  const salir = async () => {
    await cerrar();
    navigate('/login', { replace: true });
  };

  return (
    <div className="app-frame">
      {avisoInactividad && (
        <div className="aviso-inactividad" role="alert">
          <Icono nombre="alerta" tamano={16} />
          Tu sesión se cerrará en menos de un minuto por inactividad. Mueve el mouse o haz clic para seguir conectado.
        </div>
      )}

      <aside className={`sidebar ${abierto ? 'is-open' : ''}`}>
        <div className="brand">
          <span className="brand-mark">
            <Icono nombre="escudo" tamano={19} />
          </span>
          <span>
            <strong>Plataforma de Campaña</strong>
            <small>Gobernación del Caquetá</small>
          </span>
        </div>

        {SECCIONES.map((seccion) => {
          const visibles = seccion.opciones.filter((o) => tienePermiso(o.permiso));
          if (visibles.length === 0) return null;
          return (
            <div key={seccion.titulo}>
              <div className="nav-seccion">{seccion.titulo}</div>
              <nav aria-label={seccion.titulo}>
                {visibles.map((o) => (
                  <NavLink key={o.ruta} to={o.ruta} onClick={() => setAbierto(false)} className={({ isActive }) => (isActive ? 'nav-item active' : 'nav-item')}>
                    <Icono nombre={o.icono} />
                    {o.etiqueta}
                  </NavLink>
                ))}
              </nav>
            </div>
          );
        })}

        <div className="sidebar-foot">
          <span className="avatar">{iniciales(nombre)}</span>
          <div className="sidebar-usuario">
            <strong title={nombre}>{nombre}</strong>
            <span>
              {rol}
              {territorio ? ` · ${territorio}` : ''}
            </span>
          </div>
        </div>
      </aside>

      {abierto && <button className="backdrop" aria-label="Cerrar menú" onClick={() => setAbierto(false)} />}

      <div className="content-frame">
        <header className="user-header">
          <div>
            <button className="mobile-menu" type="button" aria-label="Abrir menú" onClick={() => setAbierto(!abierto)}>
              <Icono nombre="menu" tamano={20} />
            </button>
            <span className="status-dot" aria-hidden="true" />
            <span>
              Sesión de <strong>{nombre}</strong>
            </span>
            <span className="role-pill">{rol}</span>
            {!enLinea && (
              <span className="pill-conexion" role="status">
                <Icono nombre="alerta" tamano={13} /> Sin conexión
              </span>
            )}
            {pendientes.length > 0 && (
              <button type="button" className="pill-pendientes" onClick={() => navigate('/registrar')} title="Registros guardados en este celular">
                {pendientes.length} por enviar
              </button>
            )}
          </div>
          <div className="user-actions">
            <button type="button" onClick={() => navigate('/cambiar-clave')} title="Cambiar contraseña">
              <Icono nombre="llave" tamano={16} />
              <span className="texto-boton">Cambiar contraseña</span>
            </button>
            <button type="button" onClick={() => void salir()} title="Cerrar sesión">
              <Icono nombre="salir" tamano={16} />
              <span className="texto-boton">Cerrar sesión</span>
            </button>
          </div>
        </header>
        <Outlet />
      </div>
    </div>
  );
}
