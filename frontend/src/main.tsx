import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import 'leaflet/dist/leaflet.css';
import '@fontsource-variable/public-sans';
import './styles.css';
import { App } from './App';
import { SesionProvider } from './sesion/SesionContext';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter><SesionProvider><App /></SesionProvider></BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
