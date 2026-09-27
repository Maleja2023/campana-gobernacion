import { api } from '../api/cliente';
import type { Metas as TMetas } from '../api/tipos';
import { Cargando, Columna, Encabezado, ErrorCarga, Progreso, Tarjeta, useOrden, Vacio } from '../componentes/Base';
import { fmtFecha, fmtNumero, nombrePropio } from '../util/formato';
import { useDatos } from '../util/useDatos';

type FilaMeta = { id: string; nombre: string; meta: number; registrados: number; porcentaje: number; fecha_limite: string };
type Clave = 'nombre' | 'porcentaje' | 'registrados' | 'fecha_limite';

function TablaMetas({ filas, etiqueta }: { filas: FilaMeta[]; etiqueta: string }) {
  const { ordenadas, orden, alternar } = useOrden<FilaMeta, Clave>(filas, (f, c) => (c === 'nombre' ? f.nombre : c === 'fecha_limite' ? f.fecha_limite : f[c]), { clave: 'porcentaje', dir: 'desc' });
  if (filas.length === 0) return <Vacio titulo="No hay metas definidas" />;
  return (
    <div className="tabla-envoltura">
      <table className="tabla">
        <thead>
          <tr>
            <Columna clave="nombre" orden={orden} alternar={alternar}>{etiqueta}</Columna>
            <Columna clave="registrados" orden={orden} alternar={alternar} derecha>Registrados</Columna>
            <Columna clave="porcentaje" orden={orden} alternar={alternar}>Avance</Columna>
            <Columna clave="fecha_limite" orden={orden} alternar={alternar} derecha>Fecha límite</Columna>
          </tr>
        </thead>
        <tbody>
          {ordenadas.map((f) => (
            <tr key={f.id}>
              <td>{nombrePropio(f.nombre)}</td>
              <td className="derecha num">
                {fmtNumero(f.registrados)} <span style={{ color: 'var(--texto-3)' }}>/ {fmtNumero(f.meta)}</span>
              </td>
              <td style={{ minWidth: 180 }}><Progreso porcentaje={f.porcentaje} etiqueta={`Avance ${f.nombre}`} /></td>
              <td className="derecha" style={{ color: 'var(--texto-2)', whiteSpace: 'nowrap' }}>{fmtFecha(f.fecha_limite)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Metas() {
  const metas = useDatos(() => api.get<TMetas>('/tablero/metas'), []);
  const d = metas.datos;
  return (
    <>
      <Encabezado titulo="Metas" descripcion="Avance de cada territorio y de cada líder frente a la meta de simpatizantes." />
      {metas.error ? <ErrorCarga mensaje={metas.error} reintentar={metas.recargar} /> : (
        <div className="rejilla">
          <Tarjeta titulo="Por territorio" sinRelleno>
            {metas.cargando || !d ? <Cargando /> : (
              <TablaMetas etiqueta="Territorio" filas={d.territorios.map((t) => ({ id: String(t.territorio_id), nombre: t.territorio, meta: t.meta, registrados: t.registrados, porcentaje: t.porcentaje, fecha_limite: t.fecha_limite }))} />
            )}
          </Tarjeta>
          <Tarjeta titulo="Por líder" sinRelleno>
            {metas.cargando || !d ? <Cargando /> : (
              <TablaMetas etiqueta="Líder" filas={d.miembros.map((m) => ({ id: `${m.miembro_id}-${m.fecha_limite}`, nombre: m.nombre ?? '—', meta: m.meta, registrados: m.registrados, porcentaje: m.porcentaje, fecha_limite: m.fecha_limite }))} />
            )}
          </Tarjeta>
        </div>
      )}
    </>
  );
}
