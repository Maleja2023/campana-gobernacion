import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import 'leaflet/dist/leaflet.css';
import '@fontsource-variable/public-sans';
import './styles.css';
import { App } from './App';
import { ApiError } from './api/cliente';
import { SesionProvider } from './sesion/SesionContext';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Un reintento ante fallas pasajeras; no si la API ya tardó 30 s en no
      // responder (504) ni si la respuesta fue un error de la solicitud (4xx).
      retry: (intentos, error) => intentos < 1 && !(error instanceof ApiError && (error.status === 504 || error.status < 500)),
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter><SesionProvider><App /></SesionProvider></BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);

// Guarda la aplicación en el dispositivo para abrirla sin conexión (solo en
// producción: en desarrollo Vite sirve los archivos de otra forma).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}
