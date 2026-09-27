import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  // Sin mapas de código fuente en producción: no exponer el código TS/JSX
  // original (rutas de archivo, lógica interna) a quien inspeccione el sitio.
  build: { sourcemap: false },
});
