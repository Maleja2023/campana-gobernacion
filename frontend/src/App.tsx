import type { ReactNode } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router';
import type { EstadoSesion } from './api/cliente';
import { AppLayout } from './layout/AppLayout';
import { AlertasPage } from './paginas/AlertasPage';
import { CambiarClavePage } from './paginas/CambiarClavePage';
import { ConfigurarMfaPage } from './paginas/ConfigurarMfaPage';
import { VerificarMfaPage } from './paginas/VerificarMfaPage';
import { LoginPage } from './paginas/LoginPage';
import { MapaPage } from './paginas/MapaPage';
import { TableroPage } from './paginas/TableroPage';
import { AgendaPage } from './paginas/AgendaPage';
import { ReportarPage } from './paginas/ReportarPage';
import { RegistroPublicoPage } from './paginas/RegistroPublicoPage';
import { RegistrarPage } from './paginas/RegistrarPage';
import { NecesidadesPage } from './paginas/NecesidadesPage';
import { RedPage } from './paginas/RedPage';
import { ReportesPage } from './paginas/ReportesPage';
import { SimpatizantesPage } from './paginas/SimpatizantesPage';
import { UsuariosPage } from './paginas/UsuariosPage';
import { DiaDPage, SinAccesoPage } from './paginas/DiaDPage';
import { MisDatosPage, PrivacidadPage } from './paginas/PrivacidadPage';
import { CumplimientoPage } from './paginas/CumplimientoPage';
import { useSesion } from './sesion/SesionContext';

/** A dónde debe ir el usuario mientras el proceso de acceso no esté LISTO. */
function rutaPendientePara(estado: EstadoSesion): string | null {
  if (estado === 'CAMBIAR_CLAVE') return '/cambiar-clave';
  if (estado === 'MFA_CONFIGURAR') return '/configurar-mfa';
  if (estado === 'MFA_VERIFICAR') return '/verificar-mfa';
  return null;
}

function Protected() {
  const { usuario, cargando } = useSesion();
  const location = useLocation();
  if (cargando) return <div className="full-state"><span className="loader" />Cargando sesión...</div>;
  if (!usuario) return <Navigate to="/login" state={{ from: location }} replace />;
  const rutaPendiente = rutaPendientePara(usuario.estado);
  if (rutaPendiente && location.pathname !== rutaPendiente) return <Navigate to={rutaPendiente} replace />;
  return <Outlet />;
}

/** Primera pantalla que el usuario puede ver, según sus permisos. */
const PANTALLAS: [permiso: string, ruta: string][] = [
  ['MAPA_VER', '/mapa'],
  ['REPORTE_VER', '/tablero'],
  ['SIMPATIZANTE_VER', '/simpatizantes'],
  ['SIMPATIZANTE_CREAR', '/registrar'],
  ['AGENDA_VER', '/agenda'],
  ['REPORTE_COMUNITARIO', '/reportar'],
  ['E14_CARGAR', '/dia-d'],
];

function Inicio() {
  const { tienePermiso } = useSesion();
  const ruta = PANTALLAS.find(([permiso]) => tienePermiso(permiso))?.[1];
  return ruta ? <Navigate to={ruta} replace /> : <SinAccesoPage />;
}

function Permission({ code, children }: { code: string; children: ReactNode }) {
  const { tienePermiso } = useSesion();
  // Sin permiso se va al inicio, que elige una pantalla permitida (nunca vuelve aquí).
  return tienePermiso(code) ? <>{children}</> : <Navigate to="/" replace />;
}

export function App() {
  return <Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route path="/r/:codigo" element={<RegistroPublicoPage />} />
    <Route path="/privacidad" element={<PrivacidadPage />} />
    <Route path="/mis-datos" element={<MisDatosPage />} />
    <Route element={<Protected />}>
      <Route path="/cambiar-clave" element={<CambiarClavePage />} />
      <Route path="/configurar-mfa" element={<ConfigurarMfaPage />} />
      <Route path="/verificar-mfa" element={<VerificarMfaPage />} />
      <Route element={<AppLayout />}>
        <Route index element={<Inicio />} />
        <Route path="mapa" element={<Permission code="MAPA_VER"><MapaPage /></Permission>} />
        <Route path="tablero" element={<Permission code="REPORTE_VER"><TableroPage /></Permission>} />
        <Route path="reportes" element={<Permission code="REPORTE_VER"><ReportesPage /></Permission>} />
        <Route path="agenda" element={<Permission code="AGENDA_VER"><AgendaPage /></Permission>} />
        <Route path="necesidades" element={<Permission code="REPORTE_VER"><NecesidadesPage /></Permission>} />
        <Route path="reportar" element={<Permission code="REPORTE_COMUNITARIO"><ReportarPage /></Permission>} />
        <Route path="simpatizantes" element={<Permission code="SIMPATIZANTE_VER"><SimpatizantesPage /></Permission>} />
        <Route path="alertas" element={<Permission code="ALERTA_GESTIONAR"><AlertasPage /></Permission>} />
        <Route path="red" element={<Permission code="REPORTE_VER"><RedPage /></Permission>} />
        <Route path="registrar" element={<Permission code="SIMPATIZANTE_CREAR"><RegistrarPage /></Permission>} />
        <Route path="usuarios" element={<Permission code="USUARIO_GESTIONAR"><UsuariosPage /></Permission>} />
        <Route path="dia-d" element={<Permission code="E14_CARGAR"><DiaDPage /></Permission>} />
        <Route path="cumplimiento" element={<Permission code="SOLICITUD_TITULAR"><CumplimientoPage /></Permission>} />
      </Route>
    </Route>
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>;
}
