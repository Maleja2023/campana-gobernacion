import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api/cliente';
import type { Pagina, Simpatizante } from '../api/tipos';
import { Cargando, Encabezado, ErrorCarga, Tarjeta, Vacio } from '../componentes/Base';
import { Icono } from '../componentes/Icono';
import { useSesion } from '../sesion/Sesion';
import { CANALES, ESTADOS, fmtFechaHora, fmtNumero, nombrePropio } from '../util/formato';
import { useDatos } from '../util/useDatos';
import { useMunicipios } from '../util/useMunicipios';

const POR_PAGINA = 25;

function Documento({ personaId }: { personaId: string }) {
  const [estado, setEstado] = useState<'oculto' | 'cargando' | string>('oculto');
  if (estado === 'oculto') {
    return (
      <button
        className="boton boton-chico"
        onClick={async () => {
          if (!window.confirm('La consulta del documento queda registrada en la bitácora de auditoría con su usuario. ¿Continuar?')) return;
          setEstado('cargando');
          try {
            const r = await api.get<{ documento: string }>(`/simpatizantes/${personaId}/documento`);
            setEstado(r.documento);
          } catch (e) {
            setEstado('oculto');
            window.alert(e instanceof Error ? e.message : 'No fue posible consultar el documento');
          }
        }}
      >
        <Icono nombre="candado" tamano={14} /> Ver
      </button>
    );
  }
  return <span className="num">{estado === 'cargando' ? '…' : estado}</span>;
}

export function Simpatizantes() {
  const { puede } = useSesion();
  const municipios = useMunicipios();
  const [texto, setTexto] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [municipioId, setMunicipioId] = useState('');
  const [estado, setEstado] = useState('');
  const [pagina, setPagina] = useState(1);

  // Espera a que el usuario deje de escribir antes de consultar
  useEffect(() => {
    const t = setTimeout(() => {
      setBusqueda(texto.trim());
      setPagina(1);
    }, 350);
    return () => clearTimeout(t);
  }, [texto]);

  const lista = useDatos(
    () =>
      api.get<Pagina<Simpatizante>>('/simpatizantes', {
        pagina,
        porPagina: POR_PAGINA,
        texto: busqueda.length >= 2 ? busqueda : undefined,
        municipioId: municipioId || undefined,
        estado: estado || undefined,
      }),
    [pagina, busqueda, municipioId, estado],
  );

  const datos = lista.datos;
  const paginas = datos ? Math.max(1, Math.ceil(datos.total / POR_PAGINA)) : 1;
  const verDocumento = puede('DOCUMENTO_VER');

  return (
    <>
      <Encabezado
        titulo="Simpatizantes"
        descripcion="Personas registradas en su territorio. Los documentos y teléfonos se guardan cifrados."
        acciones={puede('SIMPATIZANTE_CREAR') && (
          <Link className="boton boton-primario" to="/registrar">
            <Icono nombre="mas" tamano={16} /> Registrar simpatizante
          </Link>
        )}
      />

      <Tarjeta sinRelleno>
        <div className="filtros" style={{ marginTop: -12 }}>
          <label className="campo">
            <span>Buscar</span>
            <div className="entrada-con-icono">
              <Icono nombre="buscar" tamano={16} />
              <input className="entrada" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Nombre o apellido" />
            </div>
          </label>
          <label className="campo">
            <span>Municipio</span>
            <select className="entrada" value={municipioId} onChange={(e) => { setMunicipioId(e.target.value); setPagina(1); }}>
              <option value="">Todos</option>
              {municipios.datos?.map((m) => (
                <option key={m.id} value={m.id}>{nombrePropio(m.nombre)}</option>
              ))}
            </select>
          </label>
          <label className="campo">
            <span>Estado</span>
            <select className="entrada" value={estado} onChange={(e) => { setEstado(e.target.value); setPagina(1); }}>
              <option value="">Todos</option>
              {Object.entries(ESTADOS).map(([codigo, nombre]) => (
                <option key={codigo} value={codigo}>{nombre}</option>
              ))}
            </select>
          </label>
        </div>

        {lista.error ? (
          <div style={{ paddingTop: 16 }}><ErrorCarga mensaje={lista.error} reintentar={lista.recargar} /></div>
        ) : lista.cargando && !datos ? (
          <div style={{ paddingTop: 16 }}><Cargando filas={8} /></div>
        ) : datos && datos.datos.length === 0 ? (
          <Vacio titulo="No hay simpatizantes con esos filtros">Pruebe con otro nombre o municipio.</Vacio>
        ) : datos ? (
          <>
            <div className="tabla-envoltura" style={{ opacity: lista.cargando ? 0.6 : 1 }}>
              <table className="tabla">
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th>Residencia</th>
                    <th className="ocultar-movil">Referido por</th>
                    <th className="ocultar-movil">Canal</th>
                    <th>Estado</th>
                    <th className="ocultar-movil">Registrado</th>
                    {verDocumento && <th>Documento</th>}
                  </tr>
                </thead>
                <tbody>
                  {datos.datos.map((s) => (
                    <tr key={s.persona_id}>
                      <td><strong style={{ fontWeight: 600 }}>{nombrePropio(`${s.nombres} ${s.apellidos}`)}</strong></td>
                      <td>
                        {nombrePropio(s.territorio_residencia)}
                        <span className="secundario">{nombrePropio(s.municipio)}</span>
                      </td>
                      <td className="ocultar-movil">{s.referido_por ? nombrePropio(s.referido_por) : '—'}</td>
                      <td className="ocultar-movil">{CANALES[s.canal_codigo] ?? s.canal_codigo}</td>
                      <td>
                        <span className={`etiqueta ${s.estado_codigo === 'ACTIVO' ? 'etiqueta-bien' : s.estado_codigo === 'EN_REVISION' ? 'etiqueta-aviso' : ''}`}>
                          {ESTADOS[s.estado_codigo] ?? s.estado_codigo}
                        </span>
                      </td>
                      <td className="ocultar-movil" style={{ color: 'var(--texto-2)', whiteSpace: 'nowrap' }}>{fmtFechaHora(s.capturado_en)}</td>
                      {verDocumento && <td><Documento personaId={s.persona_id} /></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="paginacion">
              <span className="num">
                {fmtNumero((pagina - 1) * POR_PAGINA + 1)}–{fmtNumero(Math.min(pagina * POR_PAGINA, datos.total))} de {fmtNumero(datos.total)}
              </span>
              <div>
                <button className="boton boton-chico" disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)}>
                  <Icono nombre="flechaIzq" tamano={14} /> Anterior
                </button>
                <button className="boton boton-chico" disabled={pagina >= paginas} onClick={() => setPagina((p) => p + 1)}>
                  Siguiente <Icono nombre="flechaDer" tamano={14} />
                </button>
              </div>
            </div>
          </>
        ) : null}
      </Tarjeta>
    </>
  );
}
