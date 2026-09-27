import '@fontsource-variable/public-sans';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './estilos/app.css';
import { ProveedorSesion } from './sesion/Sesion';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ProveedorSesion>
      <App />
    </ProveedorSesion>
  </StrictMode>,
);
