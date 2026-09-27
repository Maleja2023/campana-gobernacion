import { useState } from 'react';
import { useParams } from 'react-router';
import { Encabezado, Tarjeta } from '../componentes/Base';
import { FormularioRegistro } from '../componentes/FormularioRegistro';
import { Icono } from '../componentes/Icono';

/** Registro hecho por un miembro del equipo (queda asociado a su enlace principal). */
export function RegistroInterno() {
  const [exito, setExito] = useState<string | null>(null);
  return (
    <>
      <Encabezado titulo="Registrar simpatizante" descripcion="El registro queda asociado a su enlace principal y a su usuario." />
      <div style={{ maxWidth: 760 }}>
        {exito && (
          <div className="aviso aviso-bien" style={{ marginBottom: 16 }} role="status">
            <Icono nombre="check" /> {exito} Puede registrar a otra persona.
          </div>
        )}
        <Tarjeta sinRelleno>
          <div className="registro-cuerpo" style={{ margin: 0, maxWidth: 'none' }}>
            <FormularioRegistro modo="interno" alTerminar={(m) => { setExito(m); window.scrollTo({ top: 0, behavior: 'smooth' }); }} />
          </div>
        </Tarjeta>
      </div>
    </>
  );
}

/** Formulario público al que llegan los ciudadanos desde el enlace de un líder. */
export function RegistroPublico() {
  const { codigo } = useParams();
  const [terminado, setTerminado] = useState(false);

  return (
    <div className="registro">
      <header className="registro-cabeza">
        <div>
          <div className="marca" style={{ padding: 0 }}>
            <span className="marca-logo"><Icono nombre="escudo" tamano={19} /></span>
            <span className="marca-texto">
              <strong>Campaña a la Gobernación</strong>
              <span>Departamento del Caquetá</span>
            </span>
          </div>
          <h1>Registro de simpatizantes</h1>
          <p>Déjenos sus datos para mantenerlo informado y conocer lo que necesita su vereda o barrio.</p>
        </div>
      </header>
      <main className="registro-cuerpo">
        <div className="tarjeta">
          {terminado ? (
            <div style={{ padding: '40px 24px', textAlign: 'center' }}>
              <span className="marca-logo" style={{ margin: '0 auto 16px', width: 52, height: 52, borderRadius: '50%', background: 'var(--bien)' }}>
                <Icono nombre="check" tamano={26} />
              </span>
              <h2 style={{ fontSize: 22 }}>¡Gracias por registrarse!</h2>
              <p style={{ color: 'var(--texto-2)', marginTop: 8 }}>Su registro fue recibido. Pronto le contaremos las novedades de la campaña.</p>
            </div>
          ) : (
            <FormularioRegistro modo="publico" codigoLink={codigo} alTerminar={() => { setTerminado(true); window.scrollTo({ top: 0 }); }} />
          )}
        </div>
        <p style={{ fontSize: 12, color: 'var(--texto-3)', textAlign: 'center', marginTop: 16 }}>
          <Icono nombre="candado" tamano={12} /> Sus datos se guardan cifrados y se tratan conforme a la Ley 1581 de 2012.
        </p>
      </main>
    </div>
  );
}
