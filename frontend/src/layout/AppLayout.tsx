import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { useSesion } from '../sesion/SesionContext';

const opciones = [
  ['Tablero', '/tablero', 'REPORTE_VER'], ['Mapa', '/mapa', 'MAPA_VER'], ['Agenda territorial', '/agenda', 'AGENDA_VER'], ['Reportar necesidad', '/reportar', 'REPORTE_COMUNITARIO'], ['Simpatizantes', '/simpatizantes', 'SIMPATIZANTE_VER'], ['Alertas de calidad', '/alertas', 'ALERTA_GESTIONAR'], ['Mi red', '/red', 'REPORTE_VER'], ['Registrar', '/registrar', 'SIMPATIZANTE_CREAR'], ['Usuarios', '/usuarios', 'USUARIO_GESTIONAR'],
] as const;

export function AppLayout() {
  const [abierto, setAbierto] = useState(false);
  const { usuario, tienePermiso, cerrar, avisoInactividad } = useSesion();
  const navigate = useNavigate();
  const rol = usuario?.roles[0]?.replaceAll('_', ' ') ?? 'Usuario';
  const salir = async () => { await cerrar(); navigate('/login', { replace: true }); };
  return <div className="app-frame">
    {avisoInactividad && <div className="aviso-inactividad" role="alert">Tu sesión se cerrará en menos de un minuto por inactividad. Mueve el mouse o haz clic para seguir conectado.</div>}
    <button className="mobile-menu" type="button" aria-label="Abrir menú" onClick={() => setAbierto(!abierto)}>☰</button>
    <aside className={`sidebar ${abierto ? 'is-open' : ''}`}>
      <div className="brand"><span className="brand-mark">CG</span><span><strong>Campaña</strong><small>Gobernación</small></span></div>
      <nav aria-label="Navegación principal">{opciones.filter(([, , permiso]) => tienePermiso(permiso)).map(([label, path]) => <NavLink key={path} to={path} onClick={() => setAbierto(false)} className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}>{label}</NavLink>)}</nav>
      <div className="sidebar-foot"><span className="status-dot" /> Acceso territorial activo</div>
    </aside>
    {abierto && <button className="backdrop" aria-label="Cerrar menú" onClick={() => setAbierto(false)} />}
    <div className="content-frame">
      <header className="user-header"><div><span className="eyebrow">Espacio de trabajo</span><strong>{usuario?.nombres} {usuario?.apellidos}</strong><span className="role-pill">{rol}</span></div><div className="user-actions"><button type="button" onClick={() => navigate('/cambiar-clave')}>Cambiar contraseña</button><button type="button" onClick={() => void salir()}>Cerrar sesión</button></div></header>
      <Outlet />
    </div>
  </div>;
}
