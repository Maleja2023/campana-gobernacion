import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { Icono } from '../componentes/Icono';
import { SiluetaCaqueta } from '../componentes/Silueta';
import { useSesion } from '../sesion/SesionContext';

const RUTA_POR_ESTADO: Record<string, string> = {
  CAMBIAR_CLAVE: '/cambiar-clave',
  MFA_CONFIGURAR: '/configurar-mfa',
  MFA_VERIFICAR: '/verificar-mfa',
};

/** Panel institucional (izquierda) que comparten el ingreso y la configuración del doble factor. */
export function PanelMarca({ titulo, children }: { titulo: string; children?: ReactNode }) {
  return (
    <section className="auth-art">
      <div className="brand">
        <span className="brand-mark">
          <Icono nombre="escudo" tamano={19} />
        </span>
        <span>
          <strong>Plataforma de Campaña</strong>
          <small>Gobernación del Caquetá</small>
        </span>
      </div>
      <p className="eyebrow">Gobernación del Caquetá</p>
      <h1>{titulo}</h1>
      {children}
      <div className="auth-puntos">
        <span>
          <Icono nombre="candado" tamano={16} /> Datos cifrados
        </span>
        <span>
          <Icono nombre="escudo" tamano={16} /> Ley 1581 de 2012
        </span>
        <span>
          <Icono nombre="mapa" tamano={16} /> Cartografía DANE
        </span>
      </div>
      <SiluetaCaqueta className="auth-silueta" />
    </section>
  );
}

export function LoginPage() {
  const { usuario, iniciar } = useSesion();
  const navigate = useNavigate();
  const [login, setLogin] = useState('');
  const [clave, setClave] = useState('');
  const [verClave, setVerClave] = useState(false);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);

  if (usuario) return <Navigate to={RUTA_POR_ESTADO[usuario.estado] ?? '/'} replace />;

  async function enviar(event: FormEvent) {
    event.preventDefault();
    setCargando(true);
    setError('');
    try {
      const result = await iniciar(login, clave);
      navigate(RUTA_POR_ESTADO[result.estado] ?? '/', { replace: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No fue posible iniciar sesión.');
    } finally {
      setCargando(false);
    }
  }

  return (
    <main className="auth-page">
      <PanelMarca titulo="Organización territorial para los 16 municipios del Caquetá.">
        <p>Simpatizantes, estructura de líderes, agenda y necesidades de cada vereda, según el rol y el territorio de cada usuario.</p>
      </PanelMarca>
      <form className="auth-card" onSubmit={enviar}>
        <h2>Iniciar sesión</h2>
        <p className="helper">Ingresa con el usuario que te asignó la coordinación de la campaña.</p>
        {error && (
          <div className="form-error" role="alert">
            <Icono nombre="alerta" tamano={17} />
            {error}
          </div>
        )}
        <label>
          Correo electrónico
          <input type="email" value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" placeholder="nombre@campana.co" required autoFocus />
        </label>
        <label>
          Contraseña
          <span style={{ position: 'relative', display: 'block' }}>
            <input
              type={verClave ? 'text' : 'password'}
              value={clave}
              onChange={(e) => setClave(e.target.value)}
              autoComplete="current-password"
              required
              style={{ paddingRight: 44 }}
            />
            <button
              type="button"
              className="icon-button"
              onClick={() => setVerClave((v) => !v)}
              aria-label={verClave ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              style={{ position: 'absolute', right: 3, top: 3, color: 'var(--texto-3)' }}
            >
              <Icono nombre="ojo" />
            </button>
          </span>
        </label>
        <button className="primary-button" type="submit" disabled={cargando}>
          {cargando ? 'Verificando…' : 'Ingresar'}
        </button>
        <p className="auth-legal">
          Acceso restringido al equipo de campaña. Cada ingreso y cada consulta de datos personales quedan registrados en la bitácora de auditoría.
        </p>
        <p className="auth-legal">
          <Link to="/privacidad">Política de tratamiento de datos</Link> · <Link to="/mis-datos">Mis datos</Link>
        </p>
      </form>
    </main>
  );
}
