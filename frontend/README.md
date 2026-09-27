# Frontend de campaña

Aplicación Vite + React + TypeScript para la plataforma de campaña de la Gobernación del Caquetá.

## Instalación

```powershell
npm install
Copy-Item .env.example .env
```

Configura `VITE_API_URL` y, si aplica, el proveedor de teselas en `VITE_TILES_URL`.

## Arranque

```powershell
npm run dev
```

La aplicación queda disponible en `http://localhost:5173`. La API debe estar ejecutándose en `http://localhost:3000` y permitir CORS desde ese origen.

## Validación

```powershell
npm run build
npm run lint
```

## Estructura

- `src/api/cliente.ts`: único cliente HTTP y tipos de la API.
- `src/sesion/`: sesión, token en `sessionStorage` y permisos.
- `src/layout/`: menú lateral y encabezado autenticado.
- `src/paginas/`: login, cambio de clave, mapa y marcadores de módulos pendientes.
- `src/componentes/`: estados de carga y error.

El mapa está en `/mapa` y requiere el permiso `MAPA_VER`.
