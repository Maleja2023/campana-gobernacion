import { useMemo, useState } from 'react';
import { api } from '../api/cliente';
import type { MiembroRed } from '../api/tipos';
import { Cargando, Encabezado, ErrorCarga, Iniciales, Kpi, Tarjeta, Vacio } from '../componentes/Base';
import { Icono } from '../componentes/Icono';
import { CARGOS, fmtHace, fmtNumero, nombrePropio } from '../util/formato';
import { useDatos } from '../util/useDatos';

interface Nodo extends MiembroRed {
  hijos: Nodo[];
  total: number; // simpatizantes propios + de toda su red
}

function armarArbol(filas: MiembroRed[]): Nodo[] {
  const nodos = new Map<string, Nodo>(filas.map((f) => [f.miembro_id, { ...f, hijos: [], total: 0 }]));
  const raices: Nodo[] = [];
  for (const n of nodos.values()) {
    const padre = n.superior_id ? nodos.get(n.superior_id) : undefined;
    if (padre) padre.hijos.push(n);
    else raices.push(n);
  }
  const sumar = (n: Nodo): number => (n.total = (n.activos ?? 0) + n.hijos.reduce((s, h) => s + sumar(h), 0));
  raices.forEach(sumar);
  const ordenar = (lista: Nodo[]) => {
    lista.sort((a, b) => b.total - a.total || a.nombre.localeCompare(b.nombre, 'es'));
    lista.forEach((n) => ordenar(n.hijos));
  };
  ordenar(raices);
  return raices;
}

function Rama({ nodo, abiertos, alternar }: { nodo: Nodo; abiertos: Set<string>; alternar: (id: string) => void }) {
  const abierto = abiertos.has(nodo.miembro_id);
  return (
    <li>
      <div className="nodo">
        {nodo.hijos.length > 0 ? (
          <button className="nodo-alternar" aria-expanded={abierto} aria-label={abierto ? 'Contraer' : 'Expandir'} onClick={() => alternar(nodo.miembro_id)}>
            <Icono nombre="flechaAbajo" tamano={16} />
          </button>
        ) : (
          <span style={{ width: 24, flex: 'none' }} />
        )}
        <Iniciales nombre={nodo.nombre} />
        <div style={{ minWidth: 0 }}>
          <div className="nodo-nombre">{nombrePropio(nodo.nombre)}</div>
          <div style={{ fontSize: 12.5, color: 'var(--texto-3)' }}>
            {CARGOS[nodo.cargo_codigo] ?? nodo.cargo_codigo}
            {nodo.hijos.length > 0 && ` · ${nodo.hijos.length} a cargo`}
          </div>
        </div>
        <div className="nodo-datos">
          {!nodo.activo && <span className="etiqueta">Inactivo</span>}
          <span className="ocultar-movil" style={{ color: 'var(--texto-3)' }}>{nodo.cargo_codigo === 'GERENTE' || nodo.cargo_codigo === 'COORDINADOR' ? '' : fmtHace(nodo.ultimo_registro)}</span>
          <span title="Simpatizantes de toda su red" className="num" style={{ minWidth: 70, textAlign: 'right' }}>
            <strong style={{ color: 'var(--texto)' }}>{fmtNumero(nodo.total)}</strong> simp.
          </span>
        </div>
      </div>
      {abierto && nodo.hijos.length > 0 && (
        <ul className="arbol">
          {nodo.hijos.map((h) => (
            <Rama key={h.miembro_id} nodo={h} abiertos={abiertos} alternar={alternar} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function Estructura() {
  const red = useDatos(() => api.get<MiembroRed[]>('/red/arbol'), []);
  const arbol = useMemo(() => armarArbol(red.datos ?? []), [red.datos]);
  const [abiertos, setAbiertos] = useState<Set<string> | null>(null);

  // Por defecto: abiertos los dos primeros niveles
  const visibles = abiertos ?? new Set((red.datos ?? []).filter((m) => m.profundidad <= (red.datos?.[0]?.profundidad ?? 1)).map((m) => m.miembro_id));
  const alternar = (id: string) =>
    setAbiertos(() => {
      const s = new Set(visibles);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });

  const conteo = (cargo: string) => red.datos?.filter((m) => m.cargo_codigo === cargo && m.activo).length ?? 0;

  return (
    <>
      <Encabezado
        titulo="Estructura de campaña"
        descripcion="Coordinadores, líderes y sublíderes de su red, con los simpatizantes que cada uno ha sumado."
        acciones={
          red.datos && (
            <>
              <button className="boton boton-chico" onClick={() => setAbiertos(new Set(red.datos!.map((m) => m.miembro_id)))}>Expandir todo</button>
              <button className="boton boton-chico" onClick={() => setAbiertos(new Set())}>Contraer</button>
            </>
          )
        }
      />
      <div className="rejilla rejilla-kpi">
        <Kpi icono="usuario" etiqueta="Coordinadores" valor={fmtNumero(conteo('COORDINADOR'))} cargando={red.cargando} />
        <Kpi icono="red" etiqueta="Líderes" valor={fmtNumero(conteo('LIDER'))} cargando={red.cargando} />
        <Kpi icono="personas" etiqueta="Sublíderes" valor={fmtNumero(conteo('SUBLIDER'))} cargando={red.cargando} />
      </div>
      <Tarjeta titulo="Organigrama" descripcion="Ordenado por simpatizantes de cada red">
        {red.error ? <ErrorCarga mensaje={red.error} reintentar={red.recargar} /> : red.cargando ? <Cargando filas={6} /> : arbol.length === 0 ? (
          <Vacio titulo="Su usuario no tiene una red asignada" />
        ) : (
          <ul className="arbol">
            {arbol.map((n) => (
              <Rama key={n.miembro_id} nodo={n} abiertos={visibles} alternar={alternar} />
            ))}
          </ul>
        )}
      </Tarjeta>
    </>
  );
}
