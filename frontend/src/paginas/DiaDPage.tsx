import { Icono } from '../componentes/Icono';

/** Módulo del testigo electoral (fase 2). El rol y su permiso ya existen: el
 * testigo inicia sesión y llega aquí, sin acceso a ningún otro dato. */
export function DiaDPage() {
  return (
    <main className="page-content">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Testigos electorales</p>
          <h1>Día de elecciones</h1>
          <p className="dashboard-subtitle">Aquí se cargarán los formularios E-14 de tu mesa el día de la votación.</p>
        </div>
      </div>
      <section className="dashboard-block" style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
        <Icono nombre="calendario" tamano={22} />
        <div>
          <h2>Este módulo se habilita para la jornada electoral</h2>
          <p className="helper" style={{ marginTop: 6 }}>
            Tu cuenta ya está lista. La coordinación te avisará cuándo empieza la capacitación y la carga de resultados.
          </p>
        </div>
      </section>
    </main>
  );
}

export function SinAccesoPage() {
  return (
    <main className="page-content">
      <section className="state-card">
        <Icono nombre="candado" tamano={26} />
        <strong>Tu usuario no tiene pantallas asignadas</strong>
        <span>Pide a la coordinación de la campaña que revise tu rol.</span>
      </section>
    </main>
  );
}
