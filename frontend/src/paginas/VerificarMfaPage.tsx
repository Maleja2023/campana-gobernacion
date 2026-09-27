import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../api/cliente';
import { useSesion } from '../sesion/SesionContext';
import { PanelMarca } from './LoginPage';

export function VerificarMfaPage() {
  const { refrescar, cerrar } = useSesion();
  const navigate = useNavigate();
  const [modo, setModo] = useState<'totp' | 'recuperacion'>('totp');
  const [codigo, setCodigo] = useState('');
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);

  async function enviar(event: FormEvent) {
    event.preventDefault();
    setError('');
    setCargando(true);
    try {
      if (modo === 'totp') await api.mfaVerificar(codigo);
      else await api.mfaRecuperacion(codigo);
      await refrescar();
      navigate('/', { replace: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No fue posible verificar el código.');
    } finally {
      setCargando(false);
    }
  }

  function cambiarModo() {
    setModo(modo === 'totp' ? 'recuperacion' : 'totp');
    setCodigo('');
    setError('');
  }

  return (
    <main className="auth-page">
      <PanelMarca titulo="Confirma tu identidad">
        <p>Esta cuenta tiene doble factor activado. Abre tu app de autenticación e ingresa el código de 6 dígitos.</p>
      </PanelMarca>
      <form className="auth-card" onSubmit={enviar}>
        <p className="eyebrow">Doble factor</p>
        <h2>{modo === 'totp' ? 'Código de la app' : 'Código de recuperación'}</h2>
        {modo === 'totp' ? (
          <label>
            Código de 6 dígitos
            <input
              autoFocus
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))}
              required
            />
          </label>
        ) : (
          <label>
            Código de recuperación
            <input autoFocus placeholder="XXXX-XXXX" maxLength={9} value={codigo} onChange={(e) => setCodigo(e.target.value.toUpperCase())} required />
          </label>
        )}
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <button className="primary-button" disabled={cargando}>
          {cargando ? 'Verificando...' : 'Verificar'}
        </button>
        <button type="button" className="back-link" onClick={cambiarModo}>
          {modo === 'totp' ? 'Perdí el celular: usar un código de recuperación' : 'Volver a ingresar el código de la app'}
        </button>
        <button type="button" className="back-link" onClick={() => void cerrar().then(() => navigate('/login', { replace: true }))}>
          Cerrar sesión
        </button>
      </form>
    </main>
  );
}
