# Aplicación web – Plataforma de campaña

React 19 + TypeScript + Vite + Leaflet. Consume la API de `backend/`.

## Arranque

```
npm install
npm run dev
```

Abre http://localhost:5173. En desarrollo, las peticiones a `/api` se redirigen
a la API en el puerto 3000 (debe estar corriendo: `npm run start:dev` en `backend/`).

## Pantallas

| Ruta | Pantalla | Permiso |
|---|---|---|
| `/` | Tablero: indicadores, registros diarios, líderes, metas | `REPORTE_VER` |
| `/mapa` | Mapa territorial con navegación departamento → municipio → veredas | `MAPA_VER` |
| `/simpatizantes` | Lista con búsqueda, filtros y consulta auditada del documento | `SIMPATIZANTE_VER` |
| `/estructura` | Organigrama de coordinadores, líderes y sublíderes | `REPORTE_VER` |
| `/metas` | Avance de metas por territorio y por líder | `REPORTE_VER` |
| `/necesidades` | Necesidades por municipio y tema | `REPORTE_VER` |
| `/registrar` | Registro de simpatizantes por el equipo | `SIMPATIZANTE_CREAR` |
| `/enlaces` | Enlaces de referido del usuario | — |
| `/r/:codigo` | Formulario público de registro (sin sesión) | — |

El menú solo muestra lo que el usuario puede ver; la API vuelve a validar cada permiso.

## Producción

```
npm run build
```

Publica la carpeta `dist/` en cualquier servidor estático, redirigiendo todas las
rutas a `index.html`. Si la API está en otro dominio, define `VITE_API_URL`
antes de compilar (ver `.env.example`) y ajusta `CORS_ORIGEN` en la API.

## Mapas base

"Claro" (CARTO), "Calles" (OpenStreetMap) y "Satélite" (Esri) se cargan desde
internet. Los polígonos de municipios y veredas vienen de la base de datos
(cartografía del DANE), no de esos mapas.
