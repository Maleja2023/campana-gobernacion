import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/cliente';
import { useSesion } from '../sesion/SesionContext';
import { PanelMarca } from './LoginPage';
import { Cargando, ErrorEstado } from '../componentes/Estados';

export function ConfigurarMfaPage() {
  const { refrescar, cerrar } = useSesion();
  const navigate = useNavigate();
  const config = useQuery({ queryKey: ['mfa-configurar'], queryFn: api.mfaConfigurar, staleTime: Infinity, retry: false });
  const [codigo, setCodigo] = useState('');
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);
  const [codigosRecuperacion, setCodigosRecuperacion] = useState<string[] | null>(null);

  async function confirmar(event: FormEvent) {
    event.preventDefault();
    setError('');
    setCargando(true);
    try {
      const resultado = await api.mfaConfirmar(codigo);
      setCodigosRecuperacion(resultado.codigosRecuperacion);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No fue posible confirmar el código.');
    } finally {
      setCargando(false);
    }
  }

  async function continuar() {
    await refrescar();
    navigate('/', { replace: true });
  }

  if (config.isPending) return <main className="full-state"><Cargando texto="Preparando el doble factor..." /></main>;
  if (config.isError || !config.data) {
    return <main className="full-state"><ErrorEstado mensaje="No fue posible generar el código. Intenta de nuevo." reintentar={() => void config.refetch()} /></main>;
  }

  if (codigosRecuperacion) {
    return (
      <main className="auth-page change-page">
        <section className="auth-card mfa-card">
          <p className="eyebrow">Doble factor activado</p>
          <h1>Guarda estos códigos de recuperación</h1>
          <p className="helper">
            Cada uno sirve una sola vez, por si alguna vez pierdes el celular. Guárdalos en un lugar seguro: no se
            vuelven a mostrar.
          </p>
          <ul className="recovery-codes">
            {codigosRecuperacion.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <button className="primary-button" onClick={() => void continuar()}>
            Ya los guardé, continuar
          </button>
        </section>
      </main>
    );
  }

  const secreto = new URL(config.data.otpauthUri).searchParams.get('secret') ?? '';

  return (
    <main className="auth-page">
      <PanelMarca titulo="Activa la verificación en dos pasos">
        <p>Tu rol exige verificación en dos pasos. Escanea el código con una app de autenticación (Google Authenticator, Authy, 1Password, etc.) y escribe el código de 6 dígitos que te muestre.</p>
      </PanelMarca>
      <form className="auth-card" onSubmit={confirmar}>
        <p className="eyebrow">Doble factor</p>
        <h2>Escanea y confirma</h2>
        <img className="mfa-qr" src={config.data.qr} alt="Código QR para configurar el doble factor" />
        <details className="mfa-manual">
          <summary>¿No puedes escanear? Ingresa el código manualmente</summary>
          <code>{secreto}</code>
        </details>
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
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <button className="primary-button" disabled={cargando || codigo.length !== 6}>
          {cargando ? 'Verificando...' : 'Confirmar'}
        </button>
        <button type="button" className="back-link" onClick={() => void cerrar().then(() => navigate('/login', { replace: true }))}>
          Cancelar y cerrar sesión
        </button>
      </form>
    </main>
  );
}
