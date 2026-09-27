# Plataforma de campaña – Gobernación del Caquetá

## Estructura

```
campana-gobernacion/
├── database/
│   ├── 00_instalacion_completa.sql  TODO en un archivo (01 a 05 juntos)
│   ├── 01_esquema.sql            75 tablas, llaves, restricciones, auditoría y catálogos
│   ├── 02_funciones.sql          33 funciones y procedimientos
│   ├── 03_triggers.sql           disparadores de reglas de negocio
│   ├── 04_vistas.sql             24 vistas + 1 vista materializada (mapa)
│   ├── 05_seguridad.sql          roles, permisos y 21 políticas de seguridad por fila
│   ├── 06_importar_gpkg.bat      importa caqueta.gpkg al esquema staging
│   ├── 07_carga_territorio.sql   carga el territorio real del Caquetá
│   ├── 08_datos_demo.sql         (opcional) 800 simpatizantes ficticios para pruebas
│   └── 09_consultas_utiles.sql   consultas de referencia para la API y reportes
├── datos_gis/
│   └── caqueta.gpkg
├── backend/                      (siguiente fase: API en NestJS)
└── frontend/                     (siguiente fase: aplicación web)
```

## Requisitos

- PostgreSQL 16 con PostGIS (instalador de EDB + Stack Builder)
- QGIS (trae ogr2ogr, que usa el paso 06)
- Visual Studio Code

## Instalación (en este orden)

1. En pgAdmin, crear la base `campana_gobernacion`.
2. Query Tool sobre esa base: ejecutar `00_instalacion_completa.sql`
   (o, si prefieres por partes, `01` a `05` en orden; nunca ambos).
3. En "OSGeo4W Shell", dentro de la carpeta `database`, ejecutar `06_importar_gpkg.bat`.
4. En pgAdmin, ejecutar `07_carga_territorio.sql`.
5. (Opcional, solo en una base de pruebas) ejecutar `08_datos_demo.sql`.

Resultado esperado del paso 4: 1 departamento, 16 municipios, 4 comunas,
13 corregimientos, 1.274 veredas y 146 puestos de votación.

Para volver a empezar de cero: borrar la base (clic derecho > Delete) y repetir.

## Usuarios de la base

- La API se conecta con un usuario que pertenezca a `rol_app`, nunca con `postgres`:
  `CREATE ROLE api_campana LOGIN PASSWORD '<contraseña fuerte>' IN ROLE rol_app;`
- En cada transacción la API indica el usuario: `SET LOCAL app.usuario_id = '<uuid>';`

## Tareas programadas

El backend las ejecuta solo (`backend/src/mantenimiento/`, con `@nestjs/schedule`),
mientras el proceso de la API esté corriendo:

- `campana.refrescar_conteos()` cada 10 minutos (mapa).
- `chatbot.purgar_mensajes()` una vez al día, a las 3 a.m.

Si prefieres programarlas en la propia base de datos en vez de en el backend
(por ejemplo con `pg_cron`), puedes seguir llamándolas manualmente:

- `SELECT campana.refrescar_conteos();` cada 5 a 15 minutos (mapa).
- `SELECT chatbot.purgar_mensajes();` una vez al día.

## Seguridad

- Nunca subir contraseñas ni llaves de cifrado al repositorio (usar `.env`).
- Nunca ejecutar `08_datos_demo.sql` en producción.

## Pendientes

### Backend

1. Solicitudes de titulares según la Ley 1581: consulta y supresión de datos, con atención dentro de los plazos.
2. Preparación para producción: cabeceras de seguridad, IP real detrás de Cloudflare, logs, respaldos y despliegue.

Ya implementado (no listado arriba): doble factor (2FA); editar/retirar simpatizantes
(`PATCH /simpatizantes/:personaId`, `POST /simpatizantes/:personaId/retirar`,
permiso `SIMPATIZANTE_EDITAR`, pantalla en `/simpatizantes`); tareas programadas
(`backend/src/mantenimiento/`); alertas de calidad: listar y resolverlas
(`GET/PATCH /calidad/alertas`, permiso `ALERTA_GESTIONAR`, pantalla en `/alertas`);
exportes a Excel con motivo auditado (`POST /simpatizantes/exportar`, permisos
`EXPORTAR` + `SIMPATIZANTE_VER`, queda en `auditoria.exportaciones`).

### Fase 2

- Clasificación de necesidades con IA.
- Eventos con QR.
- Comunicaciones.
- Bot de Telegram.
- Día D.
- Registro sin conexión.
