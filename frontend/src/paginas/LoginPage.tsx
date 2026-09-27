import { FormEvent, useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { useSesion } from '../sesion/SesionContext';

const RUTA_POR_ESTADO: Record<string, string> = {
  CAMBIAR_CLAVE: '/cambiar-clave',
  MFA_CONFIGURAR: '/configurar-mfa',
  MFA_VERIFICAR: '/verificar-mfa',
};

export function LoginPage() {
  const { usuario, iniciar } = useSesion(); const navigate = useNavigate();
  const [login, setLogin] = useState(''); const [clave, setClave] = useState(''); const [error, setError] = useState(''); const [cargando, setCargando] = useState(false);
  if (usuario) return <Navigate to={RUTA_POR_ESTADO[usuario.estado] ?? '/'} replace />;
  async function enviar(event: FormEvent) { event.preventDefault(); setCargando(true); setError(''); try { const result = await iniciar(login, clave); navigate(RUTA_POR_ESTADO[result.estado] ?? '/', { replace: true }); } catch (cause) { setError(cause instanceof Error ? cause.message : 'No fue posible iniciar sesión.'); } finally { setCargando(false); } }
  return <main className="auth-page"><section className="auth-art"><span className="brand-mark">CG</span><p className="eyebrow">Gobernación del Caquetá</p><h1>La campaña se entiende mejor cuando el territorio habla.</h1><p>Accede a la información que corresponde a tu rol y territorio.</p></section><form className="auth-card" onSubmit={enviar}><p className="eyebrow">Acceso seguro</p><h2>Iniciar sesión</h2><label>Correo electrónico<input type="email" value={login} onChange={e => setLogin(e.target.value)} autoComplete="username" required /></label><label>Contraseña<input type="password" value={clave} onChange={e => setClave(e.target.value)} autoComplete="current-password" required /></label>{error && <div className="form-error" role="alert">{error}</div>}<button className="primary-button" disabled={cargando}>{cargando ? 'Verificando...' : 'Entrar'}</button></form></main>;
}
