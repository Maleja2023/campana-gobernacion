import { Link } from 'react-router';
import { api } from '../api/cliente';
import type { FilaRanking, Indicadores, Metas, RegistroDiario } from '../api/tipos';
import { Cargando, Encabezado, ErrorCarga, Kpi, Progreso, Tarjeta, Vacio } from '../componentes/Base';
import { GraficoRegistros } from '../componentes/GraficoRegistros';
import { Icono } from '../componentes/Icono';
import { useSesion } from '../sesion/Sesion';
import { CARGOS, fmtHace, fmtNumero, nombrePropio } from '../util/formato';
import { useDatos } from '../util/useDatos';

const DIAS = 30;

/** La API solo devuelve días con registros; los demás se completan en cero. */
function completarDias(filas: RegistroDiario[]): RegistroDiario[] {
  const porDia = new Map(filas.map((f) => [f.fecha.slice(0, 10), f.registros]));
  const hoy = new Date();
  const base = Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  return Array.from({ length: DIAS }, (_, i) => {
    const dia = new Date(base - (DIAS - 1 - i) * 86_400_000).toISOString();
    return { fecha: dia, registros: porDia.get(dia.slice(0, 10)) ?? 0 };
  });
}

function fechaLocal(desfaseDias: number) {
  const d = new Date(Date.now() - desfaseDias * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function Tablero() {
  const { perfil } = useSesion();
  const indicadores = useDatos(() => api.get<Indicadores>('/tablero/indicadores'), []);
  const diarios = useDatos(
    () => api.get<RegistroDiario[]>('/tablero/registros-diarios', { desde: fechaLocal(DIAS - 1), hasta: fechaLocal(0) }).then(completarDias),
    [],
  );
  const ranking = useDatos(() => api.get<FilaRanking[]>('/tablero/ranking', { limite: 8 }), []);
  const inactivos = useDatos(() => api.get<FilaRanking[]>('/tablero/lideres-inactivos'), []);
  const metas = useDatos(() => api.get<Metas>('/tablero/metas'), []);

  const i = indicadores.datos;
  const totalPeriodo = diarios.datos?.reduce((s, d) => s + d.registros, 0) ?? 0;
  const metaGlobal = metas.datos?.territorios.reduce(
    (acc, t) => ({ meta: acc.meta + t.meta, registrados: acc.registrados + t.registrados }),
    { meta: 0, registrados: 0 },
  );

  return (
    <>
      <Encabezado
        titulo={`Buen día, ${nombrePropio(perfil?.nombres ?? '')}`}
        descripcion="Resumen de la campaña en su territorio. Las cifras se actualizan cada pocos minutos."
      />

      {indicadores.error && <ErrorCarga mensaje={indicadores.error} reintentar={indicadores.recargar} />}
      <div className="rejilla rejilla-kpi">
        <Kpi icono="personas" etiqueta="Simpatizantes activos" valor={fmtNumero(i?.simpatizantes_activos)} cargando={indicadores.cargando}
          nota={metaGlobal && metaGlobal.meta > 0 && (perfil?.territorios.length ?? 0) > 0 ? `${Math.round((metaGlobal.registrados / metaGlobal.meta) * 100)} % de la meta territorial` : undefined} />
        <Kpi icono="calendario" etiqueta="Registros hoy" valor={fmtNumero(i?.registros_hoy)} cargando={indicadores.cargando} nota={`${fmtNumero(i?.registros_semana)} en los últimos 7 días`} />
        <Kpi icono="red" etiqueta="Miembros activos" valor={fmtNumero(i?.miembros_activos)} cargando={indicadores.cargando} nota="Coordinadores, líderes y sublíderes" />
        <Kpi icono="necesidad" etiqueta="Necesidades reportadas" valor={fmtNumero(i?.necesidades_reportadas)} cargando={indicadores.cargando} nota={<Link to="/necesidades">Ver por municipio</Link>} />
        {i?.alertas_abiertas !== null && i?.alertas_abiertas !== undefined && (
          <Kpi icono="alerta" etiqueta="Alertas de calidad" valor={fmtNumero(i.alertas_abiertas)} nota="Posibles duplicados y datos por revisar" />
        )}
      </div>

      <div className="rejilla rejilla-2" style={{ marginBottom: 20 }}>
        <Tarjeta titulo="Registros diarios" descripcion={`Últimos ${DIAS} días · ${fmtNumero(totalPeriodo)} registros`}>
          {diarios.error ? <ErrorCarga mensaje={diarios.error} reintentar={diarios.recargar} /> : diarios.cargando || !diarios.datos ? <div className="esqueleto" style={{ height: 240 }} /> : <GraficoRegistros datos={diarios.datos} />}
        </Tarjeta>

        <Tarjeta titulo="Avance de metas por territorio" descripcion="Simpatizantes registrados frente a la meta" sinRelleno
          accion={<Link to="/metas" className="boton boton-chico">Ver todas</Link>}>
          {metas.error ? <ErrorCarga mensaje={metas.error} /> : metas.cargando ? <Cargando /> : metas.datos?.territorios.length ? (
            <table className="tabla">
              <tbody>
                {metas.datos.territorios.slice(0, 6).map((t) => (
                  <tr key={t.territorio_id}>
                    <td style={{ width: '42%' }}>
                      {nombrePropio(t.territorio)}
                      <span className="secundario num">{fmtNumero(t.registrados)} de {fmtNumero(t.meta)}</span>
                    </td>
                    <td><Progreso porcentaje={t.porcentaje} etiqueta={`Avance ${t.territorio}`} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <Vacio titulo="Sin metas territoriales">Defina metas en la sección Metas.</Vacio>}
        </Tarjeta>
      </div>

      <div className="rejilla rejilla-mitades">
        <Tarjeta titulo="Líderes con más registros" descripcion="Simpatizantes activos que han referido" sinRelleno>
          {ranking.error ? <ErrorCarga mensaje={ranking.error} /> : ranking.cargando ? <Cargando /> : ranking.datos?.length ? (
            <div className="tabla-envoltura">
              <table className="tabla">
                <thead>
                  <tr>
                    <th style={{ width: 40 }}>#</th>
                    <th>Líder</th>
                    <th className="derecha">Activos</th>
                    <th className="derecha ocultar-movil">7 días</th>
                    <th className="derecha ocultar-movil">Último registro</th>
                  </tr>
                </thead>
                <tbody>
                  {ranking.datos.map((r, n) => (
                    <tr key={r.miembro_id}>
                      <td className="num" style={{ color: 'var(--texto-3)' }}>{n + 1}</td>
                      <td>
                        {nombrePropio(r.nombre)}
                        <span className="secundario">{CARGOS[r.cargo_codigo] ?? r.cargo_codigo}</span>
                      </td>
                      <td className="derecha num"><strong>{fmtNumero(r.activos)}</strong></td>
                      <td className="derecha num ocultar-movil">{fmtNumero(r.ultimos_7_dias)}</td>
                      <td className="derecha ocultar-movil" style={{ color: 'var(--texto-2)' }}>{fmtHace(r.ultimo_registro)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Vacio titulo="Aún no hay registros de líderes" />}
        </Tarjeta>

        <Tarjeta titulo="Líderes sin actividad reciente" descripcion="Sin registros en los últimos días: requieren acompañamiento" sinRelleno>
          {inactivos.error ? <ErrorCarga mensaje={inactivos.error} /> : inactivos.cargando ? <Cargando /> : inactivos.datos?.length ? (
            <table className="tabla">
              <tbody>
                {inactivos.datos.map((r) => (
                  <tr key={r.miembro_id}>
                    <td>
                      {nombrePropio(r.nombre)}
                      <span className="secundario">{CARGOS[r.cargo_codigo] ?? r.cargo_codigo}</span>
                    </td>
                    <td className="derecha">
                      <span className="etiqueta etiqueta-aviso"><Icono nombre="alerta" tamano={12} /> {fmtHace(r.ultimo_registro)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="vacio">
              <span className="etiqueta etiqueta-bien" style={{ marginBottom: 8 }}><Icono nombre="check" tamano={12} /> Al día</span>
              <strong>Todos los líderes registraron simpatizantes recientemente</strong>
            </div>
          )}
        </Tarjeta>
      </div>
    </>
  );
}
