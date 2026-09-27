import { useMemo } from 'react';
import { api } from '../api/cliente';
import type { Necesidades as TNecesidades } from '../api/tipos';
import { Cargando, Encabezado, ErrorCarga, Tarjeta, Vacio } from '../componentes/Base';
import { Icono } from '../componentes/Icono';
import { fmtNumero, nombrePropio } from '../util/formato';
import { useDatos } from '../util/useDatos';

const ESCALA = ['#eef2f6', '#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95'];

function colorCelda(valor: number, maximo: number) {
  if (valor <= 0) return { fondo: 'transparent', texto: 'var(--texto-3)' };
  const i = Math.min(ESCALA.length - 1, 1 + Math.floor((valor / maximo) * (ESCALA.length - 2)));
  return { fondo: ESCALA[i], texto: i >= 4 ? '#ffffff' : 'var(--texto)' };
}

export function Necesidades() {
  const datos = useDatos(() => api.get<TNecesidades>('/tablero/necesidades'), []);

  const matriz = useMemo(() => {
    const filas = datos.datos?.porMunicipio ?? [];
    const categorias = [...new Map(filas.map((f) => [f.categoria_codigo, f.categoria ?? f.categoria_codigo])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'es'));
    const municipios = [...new Map(filas.map((f) => [f.municipio_id, f.municipio])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'es'));
    const valor = new Map(filas.map((f) => [`${f.municipio_id}|${f.categoria_codigo}`, f.cantidad]));
    const totalCategoria = new Map(categorias.map(([c]) => [c, filas.filter((f) => f.categoria_codigo === c).reduce((s, f) => s + f.cantidad, 0)]));
    const maximo = Math.max(1, ...filas.map((f) => f.cantidad));
    return { categorias, municipios, valor, totalCategoria, maximo };
  }, [datos.datos]);

  const maxCategoria = Math.max(1, ...matriz.totalCategoria.values());
  const porCategoria = [...matriz.categorias].sort((a, b) => (matriz.totalCategoria.get(b[0]) ?? 0) - (matriz.totalCategoria.get(a[0]) ?? 0));

  return (
    <>
      <Encabezado titulo="Voz del territorio" descripcion="Necesidades que reportan los simpatizantes al registrarse, clasificadas por tema y municipio." />
      {datos.error ? <ErrorCarga mensaje={datos.error} reintentar={datos.recargar} /> : (
        <div className="rejilla">
          <Tarjeta titulo="Necesidades por municipio" descripcion="Número de reportes por tema; más oscuro, más reportes" sinRelleno>
            {datos.cargando ? <Cargando filas={6} /> : matriz.municipios.length === 0 ? <Vacio titulo="Sin reportes" /> : (
              <div className="tabla-envoltura">
                <table className="tabla calor">
                  <thead>
                    <tr>
                      <th>Municipio</th>
                      {matriz.categorias.map(([c, n]) => (
                        <th key={c} className="col">{n}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {matriz.municipios.map(([id, nombre]) => (
                      <tr key={id}>
                        <td style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{nombrePropio(nombre)}</td>
                        {matriz.categorias.map(([c, n]) => {
                          const v = matriz.valor.get(`${id}|${c}`) ?? 0;
                          const color = colorCelda(v, matriz.maximo);
                          return (
                            <td key={c} className="celda num" style={{ background: color.fondo, color: color.texto }} title={`${nombrePropio(nombre)} · ${n}: ${v}`}>
                              {v || '·'}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Tarjeta>
          <div className="rejilla rejilla-mitades" style={{ alignItems: 'start' }}>
            <Tarjeta titulo="Temas más mencionados">
              {datos.cargando ? <Cargando /> : porCategoria.length === 0 ? <Vacio titulo="Aún no hay necesidades clasificadas" /> : (
                <div style={{ display: 'grid', gap: 12 }}>
                  {porCategoria.map(([codigo, nombre]) => {
                    const total = matriz.totalCategoria.get(codigo) ?? 0;
                    return (
                      <div key={codigo}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginBottom: 4 }}>
                          <span>{nombre}</span>
                          <strong className="num">{fmtNumero(total)}</strong>
                        </div>
                        <div className="progreso-barra"><div style={{ width: `${(total / maxCategoria) * 100}%` }} /></div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Tarjeta>
            {datos.datos && datos.datos.sinPropuesta.length > 0 && (
              <Tarjeta titulo="Temas sin propuesta en el programa" descripcion="Necesidades que el programa de gobierno aún no responde" sinRelleno>
                <table className="tabla">
                  <tbody>
                    {datos.datos.sinPropuesta.map((c) => (
                      <tr key={c.codigo}>
                        <td>
                          <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                            <Icono nombre="alerta" tamano={15} className="icono-aviso" /> {c.nombre}
                          </span>
                        </td>
                        <td className="derecha num">{fmtNumero(c.necesidades)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Tarjeta>
            )}
          </div>

        </div>
      )}
    </>
  );
}
