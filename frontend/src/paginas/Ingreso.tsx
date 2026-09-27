import { useState, type FormEvent } from 'react';
import { Icono } from '../componentes/Icono';
import { SiluetaCaqueta } from '../componentes/Silueta';
import { useSesion } from '../sesion/Sesion';

export function Ingreso() {
  const { entrar, expirada } = useSesion();
  const [login, setLogin] = useState('');
  const [clave, setClave] = useState('');
  const [verClave, setVerClave] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setError(null);
    try {
      await entrar(login, clave);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No fue posible iniciar sesión.');
      setEnviando(false);
    }
  }

  return (
    <div className="acceso">
      <aside className="acceso-marca">
        <div className="marca" style={{ padding: 0 }}>
          <span className="marca-logo">
            <Icono nombre="escudo" tamano={19} />
          </span>
          <span className="marca-texto">
            <strong>Plataforma de Campaña</strong>
            <span>Gobernación del Caquetá</span>
          </span>
        </div>
        <h1>Organización territorial para los 16 municipios del Caquetá.</h1>
        <p>Seguimiento de simpatizantes, estructura de líderes, metas y necesidades de cada vereda, en un solo lugar.</p>
        <div className="acceso-puntos">
          <div>
            <Icono nombre="candado" tamano={16} /> Datos cifrados
          </div>
          <div>
            <Icono nombre="escudo" tamano={16} /> Ley 1581 de 2012
          </div>
          <div>
            <Icono nombre="mapa" tamano={16} /> Cartografía DANE
          </div>
        </div>
        <SiluetaCaqueta className="silueta" />
      </aside>

      <div className="acceso-formulario">
        <form className="acceso-caja" onSubmit={enviar}>
          <h2>Iniciar sesión</h2>
          <p>Ingrese con el usuario asignado por la coordinación de la campaña.</p>

          {expirada && !error && (
            <div className="aviso aviso-info">
              <Icono nombre="info" />
              Su sesión expiró. Ingrese de nuevo para continuar.
            </div>
          )}
          {error && (
            <div className="aviso aviso-critico" role="alert">
              <Icono nombre="alerta" />
              {error}
            </div>
          )}

          <label className="campo">
            <span>Usuario</span>
            <input className="entrada" type="email" autoComplete="username" value={login} onChange={(e) => setLogin(e.target.value)} placeholder="nombre@campana.co" required autoFocus />
          </label>
          <label className="campo">
            <span>Contraseña</span>
            <div style={{ position: 'relative' }}>
              <input className="entrada" type={verClave ? 'text' : 'password'} autoComplete="current-password" value={clave} onChange={(e) => setClave(e.target.value)} required style={{ paddingRight: 44 }} />
              <button type="button" className="boton-icono" onClick={() => setVerClave((v) => !v)} aria-label={verClave ? 'Ocultar contraseña' : 'Mostrar contraseña'} style={{ position: 'absolute', right: 3, top: 3, color: 'var(--texto-3)' }}>
                <Icono nombre="ojo" />
              </button>
            </div>
          </label>

          <button className="boton boton-primario" type="submit" disabled={enviando}>
            {enviando ? 'Verificando…' : 'Ingresar'}
          </button>

          <p className="acceso-legal">
            Acceso restringido al equipo de campaña. Cada ingreso y consulta de datos personales queda registrado en la bitácora de auditoría.
          </p>
        </form>
      </div>
    </div>
  );
}
