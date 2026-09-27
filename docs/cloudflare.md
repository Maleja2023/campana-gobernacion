# Cloudflare y panel administrativo protegido

Complementa la sección 6 de `despliegue-produccion.md`. La idea es:

- **Nadie llega al servidor sin pasar por Cloudflare.** El firewall del
  servidor solo acepta las IP de Cloudflare, y Cloudflare filtra ataques,
  bots y exceso de peticiones.
- **El panel administrativo no es público.** Se abre en un dominio aparte
  (`admin.dominio.co`) que Cloudflare Access cierra. Además del usuario,
  la contraseña y el doble factor de la plataforma, pide un código enviado
  al correo del administrador, autorizado uno por uno. En el dominio
  público (`app.dominio.co`), esas funciones responden 403 aunque alguien
  tenga la contraseña de un administrador.

```
                       ┌─ app.dominio.co ── WAF + límites ──┐
Internet ─> Cloudflare ┤                                    ├─> Nginx ─> API
                       └─ admin.dominio.co ─ Access (correo)┘   (solo IP de Cloudflare)
```

---

## 1. Qué es público y qué no

| Dominio | Quién entra | Qué se puede hacer |
|---|---|---|
| `app.dominio.co` | Cualquiera, con usuario, contraseña y doble factor | Registro público (`/r/…`), asistencia a eventos (`/e/…`), política (`/privacidad`), derechos del titular (`/mis-datos`) y el trabajo diario de líderes y coordinadores |
| `admin.dominio.co` | Solo los correos autorizados en Cloudflare Access, y además con usuario, contraseña y doble factor | Todo lo anterior, más **Usuarios**, **Protección de datos** (solicitudes de titulares y bitácora) y **exportes** |

Rutas de la API que solo responden en `admin.dominio.co`:

- `/api/usuarios`: crear usuarios y asignar roles;
- `/api/cumplimiento`: solicitudes de los titulares y sus datos;
- `/api/auditoria`: bitácora;
- `/api/simpatizantes/exportar` y `/api/reportes/exportar`: descargas masivas.

Si un coordinador necesita exportar, agregue su correo a Access (paso 3) y
entra por `admin.dominio.co`.

---

## 2. Nginx: bloquear el panel en el dominio público

En el `server` de `app.dominio.co` (sección 5 de `despliegue-produccion.md`),
**antes** del `location /api/`, agregue:

```nginx
# Panel administrativo: solo por admin.dominio.co (Cloudflare Access).
location ~ ^/api/(usuarios|cumplimiento|auditoria)(/|$)|^/api/(simpatizantes|reportes)/exportar$ {
    default_type application/json;
    return 403 '{"message":"Esta sección solo se abre desde el panel administrativo."}';
}
```

Luego copie el mismo `server` completo para `admin.dominio.co`, **sin** ese
bloque, y agregue la verificación de Access. Así, aunque alguien descubra la
IP del servidor, no entra sin haber pasado por Access:

```nginx
server {
    listen 443 ssl http2;
    server_name admin.dominio.co;
    # ... (mismo contenido que app.dominio.co, sin el bloque de arriba) ...

    # Rechaza peticiones que no traen la credencial de Cloudflare Access.
    if ($http_cf_access_jwt_assertion = "") { return 403; }
}
```

> La línea `if` es una verificación básica: solo comprueba que la cabecera
> exista. La verificación completa de la firma del token la hace Cloudflare.
> Esto basta porque el firewall solo deja pasar a Cloudflare (sección 2 del
> despliegue). Si algún día abre el servidor a otras IP, hay que validar la
> firma en el servidor.

`sudo nginx -t && sudo systemctl reload nginx`

Las cookies de sesión de la plataforma son de cada dominio: iniciar sesión
en uno no abre el otro.

---

## 3. Cloudflare Access para `admin.dominio.co`

Access es gratis hasta 50 usuarios, más que suficiente para los
administradores.

1. En el panel de Cloudflare: **Zero Trust**. La primera vez pide un nombre
   para la organización y el plan Free.
2. **Settings → Authentication → Login methods**: deje **One-time PIN**
   (código por correo). No hace falta nada más.
3. **Access → Applications → Add an application → Self-hosted**:
   - Application name: `Panel administrativo`
   - Session duration: `12 hours`
   - Application domain: `admin.dominio.co`
4. **Policy**:
   - Action: `Allow`
   - Include → **Emails**: los correos de gerente, candidato,
     administradores y del responsable de protección de datos, uno por uno.
     **No** use "Emails ending in" con dominios públicos como gmail.com.
5. Guarde. En el DNS, cree el registro `admin` igual que `app`, con el
   proxy activado (nube naranja).
6. Pruebe en una ventana privada: `https://admin.dominio.co` debe pedir el
   correo antes de mostrar nada, y `https://app.dominio.co/api/usuarios`
   debe responder 403.

Para quitarle el acceso a alguien: bórrelo de la política **y** desactive su
usuario en la plataforma.

---

## 4. WAF

**Security → WAF**:

1. **Managed rules**: active el *Cloudflare Managed Ruleset*, y el *OWASP
   Core Ruleset* si el plan lo incluye. Déjelas en modo `Block`. Si alguna
   bloquea un uso legítimo, mire el evento en *Security → Events* y excluya
   solo esa regla para esa ruta.
2. **Custom rules**. Cada una es *Create rule → Edit expression*:

   | Nombre | Expresión | Acción |
   |---|---|---|
   | Login desde fuera de Colombia | `(http.host eq "app.dominio.co" and starts_with(http.request.uri.path, "/api/auth/") and ip.geoip.country ne "CO")` | Managed Challenge |
   | Métodos raros | `(not http.request.method in {"GET" "POST" "PUT" "PATCH" "DELETE" "OPTIONS" "HEAD"})` | Block |
   | Rutas de escaneo | `(http.request.uri.path contains "/wp-" or http.request.uri.path contains ".php" or http.request.uri.path contains "/.env" or http.request.uri.path contains "/.git")` | Block |

   La primera regla no bloquea: a quien entra desde el exterior le pide
   resolver un reto. Así puede entrar alguien del equipo que esté de viaje.

3. **Bots → Bot Fight Mode**: actívelo. Si los celulares de los líderes
   empiezan a fallar al sincronizar, desactívelo y use *Super Bot Fight Mode*
   (planes pagos) con `/api/*` excluido.

---

## 5. Límite de peticiones

**Security → WAF → Rate limiting rules**. La API ya tiene sus propios
límites; estos frenan el abuso antes de que llegue al servidor. Con
*Characteristics: IP* y *Action: Block* durante 10 minutos:

| Nombre | Expresión | Límite |
|---|---|---|
| Login | `starts_with(http.request.uri.path, "/api/auth/")` | 10 peticiones por minuto |
| Registro público | `http.request.uri.path eq "/api/registro" and http.request.method eq "POST"` | 5 por minuto |
| Derechos del titular | `starts_with(http.request.uri.path, "/api/titular/") and http.request.method eq "POST"` | 5 por minuto |
| Check-in de eventos | `starts_with(http.request.uri.path, "/api/eventos-publico/") and http.request.method eq "POST"` | 30 por minuto (en un evento muchos comparten el wifi) |
| API en general | `starts_with(http.request.uri.path, "/api/")` | 300 por minuto |

- El plan Free trae **una** regla de límite de peticiones: use la de
  **Login**. Las demás requieren el plan Pro o superior.
- Para ver si un límite es muy estricto, revise *Security → Events* las
  primeras semanas.
- Líderes en un mismo punto (por ejemplo, un evento con el wifi del salón)
  comparten IP. Si se bloquean entre sí, suba el límite de *API en general*.

---

## 6. Protección contra ataques de denegación de servicio (DDoS)

- Viene activa en todos los planes y no requiere configuración: Cloudflare
  absorbe el tráfico antes de que llegue al servidor.
- Lo que la hace efectiva es que **nadie conozca la IP real del servidor**:
  - todos los registros DNS con proxy (nube naranja);
  - firewall del servidor solo para las IP de Cloudflare;
  - el servidor no envía correos directamente, porque los encabezados del
    correo revelan su IP; los envíos salen por un proveedor.
- Durante un ataque: **Overview → Under Attack Mode**. A todos los
  visitantes les muestra un reto de unos segundos. Desactívelo al terminar,
  porque también afecta al registro público.

---

## 7. Revisión mensual

- [ ] *Security → Events*: bloqueos inusuales o falsos positivos.
- [ ] Lista de correos de Access: sigue siendo la correcta.
- [ ] Lista de IP de Cloudflare en el firewall y en Nginx
  (`cloudflare.com/ips`): no ha cambiado.
- [ ] `https://app.dominio.co/api/usuarios` responde 403.
