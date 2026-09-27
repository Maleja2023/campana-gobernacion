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
├── auth/                     login, logout, sesiones, permisos y guardias
├── cli/asignar-clave.ts      asignar contraseñas desde la terminal
├── salud/                    GET /api/salud
└── territorio/               GET /api/territorio/buscar, /api/territorio/mapa
```

## Regenerar los tipos después de cambiar la base

```
npm run db:tipos
```

## Autenticación

Todas las rutas exigen login, salvo las marcadas con `@Publico()`.
Para exigir un permiso: `@RequierePermiso('MAPA_VER')`.

La sesión vive en dos cookies `httpOnly`, `SameSite=Strict` (nunca en el
cuerpo de la respuesta ni en `localStorage`/`sessionStorage`):

- `campana_acceso`: JWT de 15 minutos, `path=/api`.
- `campana_renovacion`: 32 bytes aleatorios, `path=/api/auth`, dura
  `RENOVACION_HORAS`. En la base solo se guarda su hash SHA-256
  (`acceso.sesiones.renovacion_hash`); se **rota** en cada `POST
  /api/auth/renovar`. Si alguna vez se presenta un token ya rotado (la
  cookie fue robada y usada dos veces), la API cierra esa sesión entera y
  registra `RENOVACION_REUTILIZADA`.

Toda petición `POST`/`PATCH`/`PUT`/`DELETE` exige la cabecera
`X-Requested-With: campana` (protección CSRF: un `<form>` de otro sitio no
puede fijar cabeceras propias) y, si manda `Origin`, que esté en
`CORS_ORIGENES`.

Mientras el estado de la sesión (`GET /api/auth/yo` → campo `estado`) no sea
`LISTO` — falta cambiar la clave temporal (`CAMBIAR_CLAVE`) o completar el
doble factor (`MFA_CONFIGURAR`/`MFA_VERIFICAR`) —, solo responden `/auth/*` y
`/auth/mfa/*`; cualquier otra ruta da 403 con el estado pendiente. El doble
factor (TOTP, app de autenticación) es obligatorio para los roles marcados
`requiere_mfa` en la base (`SUPERADMIN`, `GERENTE`, `CANDIDATO`,
`COORDINADOR`); quien lo activa voluntariamente también debe verificarlo en
cada sesión nueva.

Asignar una contraseña (mínimo 10 caracteres):

```
npm run usuario:clave -- gerente@demo.co "MiClaveLarga2026"
```

Los errores de todos los endpoints pasan por un único filtro global
(`src/comun/filtros/excepciones.filter.ts`), que nunca devuelve stack trace,
SQL ni nombres de tablas al cliente; cada respuesta de error trae un
`requestId` para buscarla en los logs.

## Pruebas de seguridad (e2e)

`test/seguridad.e2e-spec.ts` corre contra una base de **desarrollo** (nunca
contra producción). Verifica, entre otras cosas: que las rutas protegidas
exigen la cookie de sesión, que una petición sin `X-Requested-With` recibe
403 (CSRF), que un líder no puede ver el mapa/usuarios/metas, que la
seguridad por fila separa lo que ve un gerente de lo que ve un líder, que no
se puede usar como superior a alguien fuera de la propia red, que nadie sin
ser superadministrador puede crear un SUPERADMIN, que una sesión cerrada no
sirve, que la cuenta se bloquea tras varios intentos fallidos de login, el
flujo completo de doble factor (configurar → confirmar → verificar,
calculando el código TOTP con `otpauth` igual que lo haría una app de
autenticación), que un código TOTP o de recuperación ya usado se rechaza, y
que la renovación rota el token y cierra la sesión si detecta uno
reutilizado.

### Cuentas propias de las pruebas — nunca las de demostración

Las pruebas **nunca** inician sesión, modifican ni bloquean `gerente@demo.co`,
`coord.*@demo.co` ni `lider*@demo.co` (esas son para hacer demostraciones en
vivo). En vez de eso, `test/cuentas-prueba.ts`:

1. Al empezar la corrida, crea (si no existen todavía) cuatro cuentas
   EXCLUSIVAS de las pruebas — login `prueba.gerente@demo.co`,
   `prueba.coordinadora@demo.co`, `prueba.lider@demo.co` y
   `prueba.bloqueo@demo.co` — con SQL directo contra `CODEGEN_DATABASE_URL`
   (el mismo superusuario que usa `npm run db:tipos`, que se salta la
   seguridad por fila). Las tres primeras quedan con el mismo rol,
   territorio y posición en la red que su equivalente de demostración
   (gerente → departamento completo; coordinadora → Florencia, bajo el
   gerente de prueba; líder → bajo la coordinadora de prueba); la de bloqueo
   no necesita red, solo existir.
2. Toda persona que las pruebas creen —las cuatro cuentas y cualquier
   simpatizante que registre la prueba de registro público— tiene
   `nombres = 'PRUEBA E2E'`.
3. Al terminar la corrida (con éxito o no), borra las cuatro cuentas por
   completo: usuario, miembro, roles, territorios, link de referido,
   sesiones, factores de doble factor y códigos de recuperación, y de paso
   cualquier persona con `nombres = 'PRUEBA E2E'` (así se lleva también al
   simpatizante de prueba, por `ON DELETE CASCADE`).

Como las cuentas se crean y se borran en cada corrida, correr la suite dos
veces seguidas da el mismo resultado las dos veces: no hay doble factor ni
bloqueo que arrastrar de una corrida a la siguiente.

Antes de correrlas:

1. Instala la base con `01` a `05`, `07`, `08` (datos demo) y `10` a `16`.
2. Copia `.env.example` a `.env`; `CODEGEN_DATABASE_URL` debe apuntar a un
   usuario con permiso de escribir en `personas`, `campana` y `acceso`
   (`postgres` sirve). Completa la sección `SOLO PARA LAS PRUEBAS e2e` con
   el login/clave que quieras para las cuatro cuentas — la propia suite las
   crea y les asigna esa clave; no hace falta `npm run usuario:clave`.
3. Corre las pruebas:
   ```
   npm run test:e2e
   ```

Las credenciales viven solo en variables de entorno `TEST_PRUEBA_*`, nunca
en el código del test.
