import { useState } from 'react';
import { api } from '../api/cliente';
import type { Enlace } from '../api/tipos';
import { Cargando, Encabezado, ErrorCarga, Tarjeta, Vacio } from '../componentes/Base';
import { Icono } from '../componentes/Icono';
import { useSesion } from '../sesion/Sesion';
import { fmtFecha, fmtNumero } from '../util/formato';
import { useDatos } from '../util/useDatos';

function Copiar({ texto }: { texto: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <button
      className="boton boton-chico"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(texto);
          setCopiado(true);
          setTimeout(() => setCopiado(false), 1800);
        } catch {
          window.prompt('Copie el enlace:', texto);
        }
      }}
    >
      <Icono nombre={copiado ? 'check' : 'copiar'} tamano={14} /> {copiado ? 'Copiado' : 'Copiar'}
    </button>
  );
}

export function Enlaces() {
  const { puede } = useSesion();
  const enlaces = useDatos(() => api.get<Enlace[]>('/red/mis-links'), []);
  const [creando, setCreando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const crear = async () => {
    setCreando(true);
    setError(null);
    try {
      await api.post('/red/mis-links', {});
      enlaces.recargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No fue posible crear el enlace');
    } finally {
      setCreando(false);
    }
  };

  const cambiarEstado = async (e: Enlace) => {
    try {
      await api.patch(`/red/links/${e.id}`, { activo: !e.activo });
      enlaces.recargar();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No fue posible actualizar el enlace');
    }
  };

  return (
    <>
      <Encabezado
        titulo="Mis enlaces de registro"
        descripcion="Comparta estos enlaces por WhatsApp o redes. Cada persona que se registre queda asociada a usted."
        acciones={puede('SIMPATIZANTE_CREAR') && (
          <button className="boton boton-primario" onClick={() => void crear()} disabled={creando}>
            <Icono nombre="mas" tamano={16} /> Nuevo enlace
          </button>
        )}
      />
      {error && <div className="aviso aviso-critico" style={{ marginBottom: 16 }}><Icono nombre="alerta" /> {error}</div>}
      <Tarjeta sinRelleno>
        {enlaces.error ? <ErrorCarga mensaje={enlaces.error} reintentar={enlaces.recargar} /> : enlaces.cargando ? <Cargando /> : !enlaces.datos?.length ? (
          <Vacio titulo="No tiene enlaces de registro" />
        ) : (
          <div className="tabla-envoltura" style={{ marginTop: -12 }}>
            <table className="tabla">
              <thead>
                <tr>
                  <th>Enlace</th>
                  <th className="derecha">Registros</th>
                  <th className="ocultar-movil">Creado</th>
                  <th>Estado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {enlaces.datos.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <code style={{ fontSize: 13 }}>{e.url}</code>
                        {e.es_principal && <span className="etiqueta etiqueta-acento">Principal</span>}
                      </span>
                    </td>
                    <td className="derecha num"><strong>{fmtNumero(e.simpatizantes)}</strong></td>
                    <td className="ocultar-movil" style={{ color: 'var(--texto-2)' }}>{fmtFecha(e.creado_en)}</td>
                    <td>
                      <span className={`etiqueta ${e.activo ? 'etiqueta-bien' : ''}`}>{e.activo ? 'Activo' : 'Desactivado'}</span>
                    </td>
                    <td className="derecha" style={{ whiteSpace: 'nowrap' }}>
                      <span style={{ display: 'inline-flex', gap: 6 }}>
                        {e.activo && <Copiar texto={e.url} />}
                        {!e.es_principal && puede('SIMPATIZANTE_CREAR') && (
                          <button className="boton boton-chico" onClick={() => void cambiarEstado(e)}>{e.activo ? 'Desactivar' : 'Activar'}</button>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Tarjeta>
    </>
  );
}
