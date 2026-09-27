import { useSesion } from '../sesion/SesionContext';
export function MarcadorPage({ titulo }: { titulo: string }) { const { usuario } = useSesion(); return <main className="placeholder-page"><p className="eyebrow">Módulo en preparación</p><h1>{titulo}</h1><p>Esta sección está conectada a tu sesión como {usuario?.nombres}. La navegación y los permisos ya están listos.</p></main>; }
