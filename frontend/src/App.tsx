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
import { RedPage } from './paginas/RedPage';
import { SimpatizantesPage } from './paginas/SimpatizantesPage';
import { UsuariosPage } from './paginas/UsuariosPage';
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

function Permission({ code, children }: { code: string; children: ReactNode }) {
  const { tienePermiso } = useSesion();
  return tienePermiso(code) ? <>{children}</> : <Navigate to="/" replace />;
}

export function App() {
  return <Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route path="/r/:codigo" element={<RegistroPublicoPage />} />
    <Route element={<Protected />}>
      <Route path="/cambiar-clave" element={<CambiarClavePage />} />
      <Route path="/configurar-mfa" element={<ConfigurarMfaPage />} />
      <Route path="/verificar-mfa" element={<VerificarMfaPage />} />
      <Route element={<AppLayout />}>
        <Route index element={<Navigate to="/mapa" replace />} />
        <Route path="mapa" element={<Permission code="MAPA_VER"><MapaPage /></Permission>} />
        <Route path="tablero" element={<Permission code="REPORTE_VER"><TableroPage /></Permission>} />
        <Route path="agenda" element={<Permission code="AGENDA_VER"><AgendaPage /></Permission>} />
        <Route path="reportar" element={<Permission code="REPORTE_COMUNITARIO"><ReportarPage /></Permission>} />
        <Route path="simpatizantes" element={<Permission code="SIMPATIZANTE_VER"><SimpatizantesPage /></Permission>} />
        <Route path="alertas" element={<Permission code="ALERTA_GESTIONAR"><AlertasPage /></Permission>} />
        <Route path="red" element={<Permission code="REPORTE_VER"><RedPage /></Permission>} />
        <Route path="registrar" element={<Permission code="SIMPATIZANTE_CREAR"><RegistrarPage /></Permission>} />
        <Route path="usuarios" element={<Permission code="USUARIO_GESTIONAR"><UsuariosPage /></Permission>} />
      </Route>
    </Route>
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>;
}
