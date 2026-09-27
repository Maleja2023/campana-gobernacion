import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { Marco } from './componentes/Marco';
import { Estructura } from './paginas/Estructura';
import { Enlaces } from './paginas/Enlaces';
import { Ingreso } from './paginas/Ingreso';
import { Mapa } from './paginas/Mapa';
import { Metas } from './paginas/Metas';
import { Necesidades } from './paginas/Necesidades';
import { RegistroInterno, RegistroPublico } from './paginas/Registro';
import { Simpatizantes } from './paginas/Simpatizantes';
import { Tablero } from './paginas/Tablero';
import { useSesion } from './sesion/Sesion';
import type { ReactElement } from 'react';

function Protegida({ permiso, children }: { permiso?: string; children: ReactElement }) {
  const { puede } = useSesion();
  if (permiso && !puede(permiso)) return <Navigate to="/enlaces" replace />;
  return children;
}

function Aplicacion() {
  const { perfil, iniciando } = useSesion();
  if (iniciando) return <div className="cargando-pantalla">Cargando…</div>;
  if (!perfil) return <Ingreso />;
  return (
    <Routes>
      <Route element={<Marco />}>
        <Route index element={<Protegida permiso="REPORTE_VER"><Tablero /></Protegida>} />
        <Route path="mapa" element={<Protegida permiso="MAPA_VER"><Mapa /></Protegida>} />
        <Route path="simpatizantes" element={<Protegida permiso="SIMPATIZANTE_VER"><Simpatizantes /></Protegida>} />
        <Route path="estructura" element={<Protegida permiso="REPORTE_VER"><Estructura /></Protegida>} />
        <Route path="metas" element={<Protegida permiso="REPORTE_VER"><Metas /></Protegida>} />
        <Route path="necesidades" element={<Protegida permiso="REPORTE_VER"><Necesidades /></Protegida>} />
        <Route path="registrar" element={<Protegida permiso="SIMPATIZANTE_CREAR"><RegistroInterno /></Protegida>} />
        <Route path="enlaces" element={<Enlaces />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Formulario público: no requiere sesión */}
        <Route path="/r/:codigo" element={<RegistroPublico />} />
        <Route path="*" element={<Aplicacion />} />
      </Routes>
    </BrowserRouter>
  );
}
