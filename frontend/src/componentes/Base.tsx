import { useMemo, useState, type ReactNode } from 'react';
import { fmtPorcentaje } from '../util/formato';
import { Icono, type NombreIcono } from './Icono';

export function Encabezado({ titulo, descripcion, migas, acciones }: { titulo: string; descripcion?: ReactNode; migas?: ReactNode; acciones?: ReactNode }) {
  return (
    <header className="encabezado">
      <div>
        {migas}
        <h1>{titulo}</h1>
        {descripcion && <p>{descripcion}</p>}
      </div>
      {acciones && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{acciones}</div>}
    </header>
  );
}

export function Tarjeta({ titulo, descripcion, accion, children, className, sinRelleno }: { titulo?: string; descripcion?: ReactNode; accion?: ReactNode; children: ReactNode; className?: string; sinRelleno?: boolean }) {
  return (
    <section className={`tarjeta ${className ?? ''}`}>
      {titulo && (
        <div className="tarjeta-cabeza">
          <div>
            <h2>{titulo}</h2>
            {descripcion && <p>{descripcion}</p>}
          </div>
          {accion}
        </div>
      )}
      <div className={`tarjeta-cuerpo ${sinRelleno ? 'sin-relleno' : ''}`}>{children}</div>
    </section>
  );
}

export function Kpi({ icono, etiqueta, valor, nota, cargando }: { icono: NombreIcono; etiqueta: string; valor: ReactNode; nota?: ReactNode; cargando?: boolean }) {
  return (
    <div className="tarjeta kpi">
      <div className="kpi-etiqueta">
        <Icono nombre={icono} tamano={16} />
        {etiqueta}
      </div>
      {cargando ? <div className="esqueleto" style={{ height: 34, width: '55%' }} /> : <div className="kpi-valor">{valor}</div>}
      {nota && <div className="kpi-nota">{nota}</div>}
    </div>
  );
}

export function Cargando({ filas = 4 }: { filas?: number }) {
  return (
    <div style={{ display: 'grid', gap: 12, padding: '4px 20px 16px' }} aria-busy="true" aria-label="Cargando">
      {Array.from({ length: filas }, (_, i) => (
        <div key={i} className="esqueleto" style={{ height: 18, width: `${90 - i * 12}%` }} />
      ))}
    </div>
  );
}

export function ErrorCarga({ mensaje, reintentar }: { mensaje: string; reintentar?: () => void }) {
  return (
    <div style={{ padding: '0 20px 16px' }}>
      <div className="aviso aviso-critico" role="alert">
        <Icono nombre="alerta" />
        <div style={{ flex: 1 }}>{mensaje}</div>
        {reintentar && (
          <button className="boton boton-chico" onClick={reintentar}>
            Reintentar
          </button>
        )}
      </div>
    </div>
  );
}

export function Vacio({ titulo, children }: { titulo: string; children?: ReactNode }) {
  return (
    <div className="vacio">
      <strong>{titulo}</strong>
      {children}
    </div>
  );
}

export function Progreso({ porcentaje, etiqueta }: { porcentaje: number; etiqueta?: string }) {
  const ancho = Math.max(0, Math.min(100, porcentaje));
  return (
    <div className="progreso" role="meter" aria-valuenow={porcentaje} aria-valuemin={0} aria-valuemax={100} aria-label={etiqueta}>
      <div className="progreso-barra">
        <div style={{ width: `${ancho}%` }} />
      </div>
      <span className="progreso-valor num">{fmtPorcentaje(porcentaje)}</span>
    </div>
  );
}

export function Iniciales({ nombre }: { nombre: string }) {
  const partes = nombre.trim().split(/\s+/);
  const texto = ((partes[0]?.[0] ?? '') + (partes[1]?.[0] ?? '')).toUpperCase();
  return <span className="avatar">{texto}</span>;
}

// ---------- Ordenamiento de tablas ----------

export type Direccion = 'asc' | 'desc';

export function useOrden<T, K extends string>(filas: T[], valor: (fila: T, clave: K) => string | number | null, inicial: { clave: K; dir: Direccion }) {
  const [orden, setOrden] = useState(inicial);
  const ordenadas = useMemo(() => {
    const copia = [...filas];
    copia.sort((a, b) => {
      const va = valor(a, orden.clave);
      const vb = valor(b, orden.clave);
      if (va === vb) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      const r = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'es');
      return orden.dir === 'asc' ? r : -r;
    });
    return copia;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filas, orden]);

  const alternar = (clave: K) =>
    setOrden((o) => (o.clave === clave ? { clave, dir: o.dir === 'asc' ? 'desc' : 'asc' } : { clave, dir: clave === inicial.clave ? inicial.dir : 'asc' }));

  return { ordenadas, orden, alternar };
}

export function Columna<K extends string>({ clave, children, orden, alternar, derecha }: { clave: K; children: ReactNode; orden: { clave: K; dir: Direccion }; alternar: (k: K) => void; derecha?: boolean }) {
  const activa = orden.clave === clave;
  return (
    <th className={derecha ? 'derecha' : undefined} aria-sort={activa ? (orden.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button onClick={() => alternar(clave)}>
        {children}
        <Icono nombre={activa ? (orden.dir === 'asc' ? 'subir' : 'flechaAbajo') : 'ordenar'} tamano={13} />
      </button>
    </th>
  );
}
