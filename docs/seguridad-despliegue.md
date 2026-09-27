# Cabeceras de seguridad HTTP para producción

Este documento da los valores exactos de las cabeceras de seguridad que
`docs/despliegue-produccion.md` deja pendientes (sección 5, Nginx). Aplican al
**frontend** (la SPA servida como archivos estáticos); la API ya envía las
suyas propias con `helmet` (ver `backend/src/main.ts`).

Configúralas en **uno solo** de estos dos lugares, no en los dos a la vez
(evita valores duplicados o contradictorios):

- **Nginx**, en el `server {}` que sirve el frontend (ver el bloque de ejemplo
  en `docs/despliegue-produccion.md`), o
- **Cloudflare**: Rules → Transform Rules → Modify Response Header, o el
  gestor de "Cabeceras de seguridad"/"Security Headers" si el plan lo incluye.

## Content-Security-Policy

La CSP depende de a qué dominios llama realmente el frontend hoy:

- Su propia API (`VITE_API_URL`; en producción, en el mismo dominio bajo
  `/api`, según recomienda `despliegue-produccion.md`).
- El servidor de teselas del mapa (`VITE_TILES_URL`; por defecto
  `https://{s}.tile.openstreetmap.org/...`, es decir `a/b/c.tile.openstreetmap.org`).
- Google Fonts (`fonts.googleapis.com` para la hoja de estilos,
  `fonts.gstatic.com` para los archivos de letra que esa hoja referencia).

```
Content-Security-Policy:
  default-src 'self';
  base-uri 'self';
  object-src 'none';
  script-src 'self';
  style-src 'self' https://fonts.googleapis.com;
  font-src 'self' https://fonts.gstatic.com;
  img-src 'self' data: https://*.tile.openstreetmap.org;
  connect-src 'self' https://*.tile.openstreetmap.org;
  form-action 'self';
  frame-ancestors 'none';
  upgrade-insecure-requests
```

En una sola línea, para pegar en Nginx o en Cloudflare:

```
default-src 'self'; base-uri 'self'; object-src 'none'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https://*.tile.openstreetmap.org; connect-src 'self' https://*.tile.openstreetmap.org; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests
```

**Ajusta antes de publicar:**

- Si `VITE_API_URL` de producción **no** queda en el mismo dominio (ej.
  `https://api.dominio.co` en vez de `/api`), agrega ese origen a
  `connect-src`.
- Si cambias `VITE_TILES_URL` a otro proveedor de mapas (Mapbox, MapTiler,
  Stadia, etc.), reemplaza `https://*.tile.openstreetmap.org` en `img-src` y
  `connect-src` por el dominio de ese proveedor (revisa su documentación: casi
  siempre exige además una cabecera o parámetro de API key, no solo CSP).
- Si dejas de usar Google Fonts (por ejemplo, sirviendo las fuentes desde el
  propio dominio), quita `fonts.googleapis.com` y `fonts.gstatic.com` — es lo
  más simple y evita depender de un tercero.
- `script-src 'self'` y `style-src` sin `'unsafe-inline'`/`'unsafe-eval'` es
  lo más seguro. El build de producción de Vite no necesita ninguno de los
  dos. Si algo del mapa o los gráficos se ve roto tras activar la CSP, antes
  de aflojarla revisa la consola del navegador: casi siempre el bloqueo es de
  `img-src`/`connect-src` (un dominio que falta), no de `style-src`.
- Prueba siempre primero en el ambiente de **pruebas**, con la consola del
  navegador abierta (pestaña Network/Console), antes de aplicar en producción.

## Otras cabeceras

```
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(self), camera=(), microphone=(), payment=(), usb=()
X-Content-Type-Options: nosniff
```

| Cabecera | Por qué este valor |
|---|---|
| `Strict-Transport-Security` | Obliga al navegador a usar siempre HTTPS con este dominio (y subdominios) durante un año, incluso si alguien escribe `http://` a mano. Actívala solo cuando el sitio ya sirve **todo** por HTTPS de forma estable: es difícil de revertir rápido (queda en caché del navegador el tiempo de `max-age`). Cuando el dominio esté maduro, considera enviarlo a [hstspreload.org](https://hstspreload.org/) agregando `preload` (paso opcional, no reversible en la práctica). |
| `X-Frame-Options: DENY` | Nadie puede incrustar el sitio en un `<iframe>` de otra página (protege contra *clickjacking*: un sitio malicioso superpuesto invisible que engaña al usuario para hacer clic). `frame-ancestors 'none'` en la CSP de arriba hace lo mismo y es el estándar más nuevo; se dejan ambas por compatibilidad con navegadores viejos. |
| `Referrer-Policy` | `strict-origin-when-cross-origin` manda la URL completa solo a peticiones dentro del propio dominio, y solo el dominio (sin ruta) a sitios externos — así una URL con datos en la ruta o query no se filtra a Google Fonts ni al servidor de teselas. |
| `Permissions-Policy` | Apaga cámara, micrófono, pagos y USB (nada en el frontend los usa) y deja la geolocalización solo para el propio sitio (el registro de simpatizantes puede pedir la ubicación del navegador). Ajusta la lista si el frontend llega a usar alguna de estas APIs. |
| `X-Content-Type-Options: nosniff` | El navegador no reinterpreta un archivo como un tipo distinto al declarado en `Content-Type` (evita que, por ejemplo, un archivo subido se ejecute como script). |

## Verificar

Después de desplegar:

1. `curl -sI https://app.dominio.co | grep -i -E "strict-transport|x-frame|content-security|referrer|permissions|x-content-type"` — confirma que las seis cabeceras salen.
2. [securityheaders.com](https://securityheaders.com) contra el dominio real — apunta a nota "A" o mejor; lo que falte, casi siempre es una de las cabeceras de esta lista.
3. Abrir el sitio en el navegador con la consola abierta y navegar por **todas** las pantallas (mapa, tablero, agenda, registro público) — cualquier bloqueo de la CSP aparece ahí como error, con el dominio exacto que falta.
