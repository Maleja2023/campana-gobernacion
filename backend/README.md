# API – Plataforma de campaña

NestJS 12 + Kysely + PostgreSQL/PostGIS.

## Arranque

```
npm install
copy .env.example .env      (y llenar las claves)
npm run start:dev
```

Probar: http://localhost:3000/api/salud

## Estructura

```
src/
├── database/
│   ├── database.module.ts    conexión (pool) con el usuario api_campana
│   ├── database.service.ts   comoUsuario(): transacción con seguridad por fila
│   └── db.types.ts           tipos generados desde la base (no editar a mano)
├── salud/                    GET /api/salud
└── territorio/               GET /api/territorio/buscar, /api/territorio/mapa
```

## Regenerar los tipos después de cambiar la base

```
npm run db:tipos
```
