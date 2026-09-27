import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { useSesion } from '../sesion/Sesion';
import { CARGOS, nombrePropio } from '../util/formato';
import { Icono, type NombreIcono } from './Icono';
import { Iniciales } from './Base';

interface Opcion {
  ruta: string;
  texto: string;
  icono: NombreIcono;
  permiso?: string;
}

const SECCIONES: { titulo: string; opciones: Opcion[] }[] = [
  {
    titulo: 'Seguimiento',
    opciones: [
      { ruta: '/', texto: 'Tablero', icono: 'tablero', permiso: 'REPORTE_VER' },
      { ruta: '/mapa', texto: 'Mapa territorial', icono: 'mapa', permiso: 'MAPA_VER' },
      { ruta: '/simpatizantes', texto: 'Simpatizantes', icono: 'personas', permiso: 'SIMPATIZANTE_VER' },
    ],
  },
  {
    titulo: 'Organización',
    opciones: [
      { ruta: '/estructura', texto: 'Estructura', icono: 'red', permiso: 'REPORTE_VER' },
      { ruta: '/metas', texto: 'Metas', icono: 'meta', permiso: 'REPORTE_VER' },
      { ruta: '/necesidades', texto: 'Voz del territorio', icono: 'necesidad', permiso: 'REPORTE_VER' },
    ],
  },
  {
    titulo: 'Mi gestión',
    opciones: [
      { ruta: '/registrar', texto: 'Registrar simpatizante', icono: 'mas', permiso: 'SIMPATIZANTE_CREAR' },
      { ruta: '/enlaces', texto: 'Mis enlaces', icono: 'enlace' },
    ],
  },
];

export function Marco() {
  const { perfil, salir, puede } = useSesion();
  const [abierto, setAbierto] = useState(false);
  const ubicacion = useLocation();

  useEffect(() => setAbierto(false), [ubicacion.pathname]);

  if (!perfil) return null;
  const nombre = nombrePropio(`${perfil.nombres} ${perfil.apellidos}`);
  const rol = perfil.roles.map((r) => CARGOS[r] ?? nombrePropio(r)).join(', ');
  const territorio = perfil.territorios[0] ? nombrePropio(perfil.territorios[0].nombre) : null;

  return (
    <div className={`app ${abierto ? 'menu-abierto' : ''}`}>
      <nav className="menu" aria-label="Menú principal">
        <div className="marca">
          <span className="marca-logo">
            <Icono nombre="escudo" tamano={19} />
          </span>
          <span className="marca-texto">
            <strong>Plataforma de Campaña</strong>
            <span>Gobernación del Caquetá</span>
          </span>
        </div>

        {SECCIONES.map((seccion) => {
          const visibles = seccion.opciones.filter((o) => !o.permiso || puede(o.permiso));
          if (visibles.length === 0) return null;
          return (
            <div key={seccion.titulo}>
              <div className="menu-seccion">{seccion.titulo}</div>
              {visibles.map((o) => (
                <NavLink key={o.ruta} to={o.ruta} end={o.ruta === '/'} className={({ isActive }) => (isActive ? 'activo' : undefined)}>
                  <Icono nombre={o.icono} />
                  {o.texto}
                </NavLink>
              ))}
            </div>
          );
        })}

        <div className="menu-pie">
          <Iniciales nombre={nombre} />
          <div className="menu-usuario">
            <strong title={nombre}>{nombre}</strong>
            <span>
              {rol}
              {territorio ? ` · ${territorio}` : ''}
            </span>
          </div>
          <button className="boton-icono" onClick={() => void salir()} title="Cerrar sesión" aria-label="Cerrar sesión">
            <Icono nombre="salir" />
          </button>
        </div>
      </nav>

      {abierto && <div className="velo" onClick={() => setAbierto(false)} />}

      <div className="contenido">
        <div className="barra-superior">
          <button className="boton-icono" onClick={() => setAbierto(true)} aria-label="Abrir menú">
            <Icono nombre="menu" tamano={20} />
          </button>
          <strong>Plataforma de Campaña</strong>
        </div>
        <main className="pagina">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
