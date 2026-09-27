import { FormEvent, useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { api } from '../api/cliente';
import { useSesion } from '../sesion/SesionContext';

function validar(clave: string) { return clave.length >= 10 && /[a-zA-Z]/.test(clave) && /\d/.test(clave); }
export function CambiarClavePage() {
  const { usuario, refrescar } = useSesion(); const navigate = useNavigate(); const [actual, setActual] = useState(''); const [nueva, setNueva] = useState(''); const [confirmacion, setConfirmacion] = useState(''); const [error, setError] = useState(''); const [ok, setOk] = useState(false); const [cargando, setCargando] = useState(false);
  if (!usuario) return <Navigate to="/login" replace />;
  async function enviar(event: FormEvent) { event.preventDefault(); setError(''); if (!validar(nueva)) { setError('La nueva contraseña debe tener al menos 10 caracteres, letras y números.'); return; } if (nueva !== confirmacion) { setError('La confirmación no coincide.'); return; } setCargando(true); try { await api.cambiarClave(actual, nueva); await refrescar(); setOk(true); navigate('/', { replace: true }); } catch (cause) { setError(cause instanceof Error ? cause.message : 'No fue posible cambiar la contraseña.'); } finally { setCargando(false); } }
  return <main className="change-page"><form className="auth-card" onSubmit={enviar}><p className="eyebrow">Protección de cuenta</p><h1>{usuario.debeCambiarClave ? 'Actualiza tu contraseña temporal' : 'Cambiar contraseña'}</h1><p className="helper">Usa al menos 10 caracteres, combinando letras y números.</p><label>Contraseña actual<input type="password" value={actual} onChange={e => setActual(e.target.value)} required /></label><label>Nueva contraseña<input type="password" value={nueva} onChange={e => setNueva(e.target.value)} required /></label><label>Confirmar nueva contraseña<input type="password" value={confirmacion} onChange={e => setConfirmacion(e.target.value)} required /></label>{error && <div className="form-error" role="alert">{error}</div>}{ok && <div className="form-success">Contraseña actualizada.</div>}<button className="primary-button" disabled={cargando}>{cargando ? 'Guardando...' : 'Guardar contraseña'}</button></form></main>;
}
