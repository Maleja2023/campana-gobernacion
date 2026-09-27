# Despliegue a producción – Plataforma de campaña

Guía para publicar el sistema en internet de forma segura. Síguela en orden.
**Ningún dato real de personas entra al sistema hasta completar la lista final.**

---

## 0. Decisiones antes de empezar

| Decisión | Recomendación |
|---|---|
| Quién contrata y paga el servidor, el dominio y Cloudflare | La campaña, a su nombre. Tú administras con un usuario propio. |
| Dónde quedan los datos | Guardar datos personales fuera de Colombia es una *transferencia internacional* (Ley 1581). Verifica con la SIC que el país del proveedor tenga nivel adecuado de protección o usa un proveedor con centro de datos en Colombia. Déjalo escrito en el contrato. |
| Dominio | Uno propio de la campaña. App y API en el **mismo dominio** (`app.dominio.co` con la API en `app.dominio.co/api`): así las cookies de sesión funcionan sin CORS. |
| Servidor | VPS con Ubuntu 24.04 LTS, mínimo 2 vCPU, 4 GB de RAM y 60 GB de disco SSD. |
| Ambientes | Uno de **pruebas** (con datos demo) y uno de **producción** (sin datos demo). Nunca se prueba en producción. |

---

## 1. Arquitectura de producción

```
Internet ──> Cloudflare (WAF, anti-DDoS, HTTPS)
                │  solo Cloudflare puede llegar al servidor
                ▼
        Servidor Ubuntu (firewall)
        ├── Nginx :443
        │     ├── /        -> frontend (archivos estáticos)
        │     └── /api     -> API NestJS (127.0.0.1:3000)
        └── PostgreSQL + PostGIS (solo 127.0.0.1, nunca expuesto)
```

---

## 2. Endurecer el servidor

1. Crear el VPS e ingresar por SSH **con llave**, no con contraseña:
   ```bash
   # en tu computador
   ssh-keygen -t ed25519 -C "admin-campana"
   ```
   Agrega la llave pública al crear el servidor.
2. Crear un usuario administrador y deshabilitar el acceso de root:
   ```bash
   adduser admin && usermod -aG sudo admin
   # copiar la llave a /home/admin/.ssh/authorized_keys
   ```
   En `/etc/ssh/sshd_config`: `PermitRootLogin no`, `PasswordAuthentication no`. Luego `sudo systemctl restart ssh`.
3. Actualizaciones automáticas de seguridad y zona horaria:
   ```bash
   sudo apt update && sudo apt upgrade -y
   sudo apt install -y unattended-upgrades fail2ban
   sudo dpkg-reconfigure -plow unattended-upgrades
   sudo timedatectl set-timezone America/Bogota
   ```
4. Firewall: SSH abierto (idealmente solo desde tu IP) y puertos web **solo para las IP de Cloudflare**:
   ```bash
   sudo ufw default deny incoming
   sudo ufw default allow outgoing
   sudo ufw allow 22/tcp
   for ip in $(curl -s https://www.cloudflare.com/ips-v4); do sudo ufw allow from $ip to any port 443 proto tcp; done
   sudo ufw enable
   ```
   Revisa cada tanto la lista de IP de Cloudflare: si cambia, actualiza las reglas.

---

## 3. Base de datos

1. Instalar PostgreSQL y PostGIS (misma versión mayor que en desarrollo) y `gdal-bin` (para importar el territorio).
2. En `postgresql.conf`: `listen_addresses = 'localhost'`. En `pg_hba.conf`: solo conexiones locales con `scram-sha-256`.
3. Contraseña larga para `postgres`, guardada en el gestor de contraseñas de la campaña.
4. Instalación, en este orden:
   - `00_instalacion_completa.sql`
   - Importar `caqueta.gpkg` al esquema `staging` (mismos comandos `ogr2ogr` de `06_importar_gpkg.bat`).
   - `07_carga_territorio.sql`
   - Migraciones `10` a `37`, en orden (`22_correccion_veredas.sql` solo hace falta en bases cargadas antes de la corrección de veredas).
   - **Nunca** `08_datos_demo.sql`.
5. Crear el usuario de la API con una contraseña generada, **distinta** a la de desarrollo:
   ```sql
   CREATE ROLE api_campana LOGIN PASSWORD '<generada>' IN ROLE rol_app;
   ```
   Después, volver a ejecutar `15_endurecimiento.sql` para que le aplique los límites.
6. Cargar la política de tratamiento de datos real (versión 1) y sus finalidades, aprobadas por la campaña.

---

## 4. API (backend)

1. Instalar Node.js LTS. Crear un usuario del sistema sin privilegios: `sudo adduser --system --group campana`.
2. Copiar el backend, `npm ci`, `npm run build`.
3. Archivo `.env` de producción con **secretos nuevos** (nunca los de desarrollo):
   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"   # JWT
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # PEPPER_HMAC y LLAVE_CIFRADO
   ```
   - `NODE_ENV=production`, `TRUST_PROXY` activado, `CORS_ORIGENES` con el dominio real.
   - `TURNSTILE_SITEKEY` y `TURNSTILE_SECRETO`: créalas en el panel de Cloudflare (Turnstile → Add widget, con el dominio del formulario público). Con `COOKIE_SEGURA=true` la API no arranca sin ellas.
   - `ANTHROPIC_API_KEY` (opcional) e `IA_MODELO`: activan la clasificación de necesidades y los informes con IA. Pasos, costos y protección de datos en `docs/inteligencia-artificial.md`.
   - Permisos del archivo: `chmod 600`, dueño `campana`.
   - **`PEPPER_HMAC` y `LLAVE_CIFRADO` no pueden cambiar nunca** una vez haya datos: sin ellas, las cédulas quedan ilegibles y los duplicados dejan de detectarse. Guarda una copia en el gestor de contraseñas y otra impresa en un lugar físico seguro.
4. Servicio con systemd (`/etc/systemd/system/campana-api.service`):
   ```ini
   [Unit]
   Description=API campaña
   After=network.target postgresql.service

   [Service]
   User=campana
   WorkingDirectory=/opt/campana/backend
   EnvironmentFile=/opt/campana/backend/.env
   ExecStart=/usr/bin/node dist/main.js
   Restart=on-failure
   NoNewPrivileges=true
   ProtectSystem=strict
   ProtectHome=true
   PrivateTmp=true
   ReadWritePaths=/opt/campana/backend/logs

   [Install]
   WantedBy=multi-user.target
   ```
   `sudo systemctl enable --now campana-api`

---

## 5. Frontend y Nginx

1. `npm ci && npm run build` en el frontend, con `VITE_API_URL=/api`. Copiar `dist/` a `/opt/campana/frontend`.
2. Certificado de origen de Cloudflare (SSL/TLS → Servidor de origen) guardado en `/etc/ssl/campana/`.
3. `/etc/nginx/sites-available/campana`:
   ```nginx
   server {
       listen 443 ssl http2;
       server_name app.dominio.co;

       ssl_certificate     /etc/ssl/campana/origen.pem;
       ssl_certificate_key /etc/ssl/campana/origen.key;

       # IP real del visitante (Cloudflare). Mantener la lista actualizada.
       # set_real_ip_from <cada rango de https://www.cloudflare.com/ips-v4>;
       real_ip_header CF-Connecting-IP;

       server_tokens off;
       client_max_body_size 1m;

       # Cabeceras de seguridad (ver docs/seguridad-despliegue.md para la CSP exacta)
       add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
       add_header X-Frame-Options "DENY" always;
       add_header X-Content-Type-Options "nosniff" always;
       add_header Referrer-Policy "strict-origin-when-cross-origin" always;
       add_header Permissions-Policy "camera=(), microphone=(), geolocation=(self)" always;
       add_header Content-Security-Policy "<ver docs/seguridad-despliegue.md>" always;

       root /opt/campana/frontend;
       location / { try_files $uri /index.html; }

       # Registro sin conexión: el service worker y el index.html nunca se
       # guardan en caché del navegador/Cloudflare, para que cada versión
       # nueva llegue a los celulares. (`expires` no borra las cabeceras de arriba.)
       location = /sw.js      { expires -1; }
       location = /index.html { expires -1; }

       location /api/ {
           proxy_pass http://127.0.0.1:3000;
           proxy_set_header Host $host;
           proxy_set_header X-Forwarded-For $remote_addr;
           proxy_set_header X-Forwarded-Proto https;
       }
   }
   ```
4. `sudo nginx -t && sudo systemctl reload nginx`

---

## 6. Cloudflare

1. Agregar el dominio y cambiar los servidores DNS del dominio a los de Cloudflare.
2. Registro DNS de `app` apuntando al servidor, **con proxy activado** (nube naranja). Así nadie ve la IP real del servidor.
3. SSL/TLS en modo **Full (strict)**; activar "Always Use HTTPS" y HSTS.
4. **WAF**: activar las reglas administradas disponibles en el plan contratado.
5. **Límites de peticiones** para `/api/auth/login` y `/api/registro` (además de los que ya tiene la API).
6. Protección contra bots según el plan. Conocer el modo "Under Attack" para activarlo durante un ataque.
7. Revisa qué incluye cada plan: algunas funciones (más reglas de WAF y de límites) son de pago. Para una campaña a gobernación, el costo del plan pagado se justifica y debe ir en la propuesta.
8. **Panel administrativo en `admin.dominio.co` con Cloudflare Access**, y reglas concretas de WAF y límites: paso a paso en [`cloudflare.md`](cloudflare.md).

---

## 7. Respaldos

Un respaldo que nunca se ha restaurado no es un respaldo.

1. Copiar `scripts/respaldo.sh` a `/opt/campana/scripts/` y crear `/etc/campana/respaldo.env` (permisos 600) con las variables que explica el encabezado del script. Programarlo con cron, como `postgres`, a las 2:00 a. m.:
   ```
   0 2 * * * /opt/campana/scripts/respaldo.sh >> /var/log/campana-respaldo.log 2>&1
   ```
   - Cifra con `age` en el mismo paso del volcado: el respaldo sin cifrar nunca toca el disco. La llave privada **no** está en el servidor (está en el gestor de contraseñas). Si roban el servidor, los respaldos no sirven.
   - Copia fuera del servidor con `rclone`, en otro proveedor (almacenamiento de objetos), y verifica la copia.
   - Retención: 14 diarios y 8 semanales. Configure la misma retención en el proveedor remoto (reglas de ciclo de vida).
   - Opcional: `AVISO_URL` de healthchecks.io para que le avisen si un día no corre.
2. Respaldar aparte, y cifrado, el `.env` de producción.
3. **Prueba de restauración mensual** con `scripts/probar_restauracion.sh`, en un servidor temporal (nunca en producción):
   ```
   ./probar_restauracion.sh llave-age.txt .env-produccion
   ```
   Descarga el último respaldo, lo descifra, lo restaura en una base temporal, cuenta los registros y descifra una muestra de cédulas y teléfonos con la llave de la aplicación. Al final borra la base temporal. Anote la fecha y el resultado, y borre del servidor temporal la llave y el `.env`.

---

## 8. Monitoreo

- Monitor externo de disponibilidad sobre `https://app.dominio.co/api/salud`, con alerta por correo o Telegram.
- Alertas de disco lleno y de memoria.
- Revisión semanal de la auditoría:
  ```sql
  -- intentos de acceso fallidos por usuario, última semana
  SELECT u.login, e.accion, count(*) FROM auditoria.eventos e
    LEFT JOIN acceso.usuarios u ON u.id = e.usuario_id
   WHERE e.accion IN ('LOGIN_FALLIDO','MFA_FALLIDO','RENOVACION_REUTILIZADA')
     AND e.ocurrido_en > now() - interval '7 days'
   GROUP BY 1, 2 ORDER BY 3 DESC;

  -- exportaciones de datos, última semana
  SELECT u.login, x.motivo, x.cantidad_registros, x.exportado_en
    FROM auditoria.exportaciones x JOIN acceso.usuarios u ON u.id = x.usuario_id
   WHERE x.exportado_en > now() - interval '7 days';
  ```
- Mensual: `npm audit` en backend y frontend, y actualizaciones menores de PostgreSQL y Node.

---

## 9. Plan de respuesta a incidentes

Si se sospecha un acceso indebido:

1. **Contener**: activar "Under Attack" en Cloudflare; cerrar todas las sesiones:
   ```sql
   UPDATE acceso.sesiones SET cerrada_en = now() WHERE cerrada_en IS NULL;
   ```
   Desactivar las cuentas comprometidas.
2. **Cambiar secretos**: `JWT_SECRETO`, la contraseña de `api_campana` y la de `postgres`. (`PEPPER_HMAC` y `LLAVE_CIFRADO` no se cambian sin un procedimiento de recifrado.)
3. **Investigar** con la auditoría: qué usuario, qué IP, qué consultó o exportó.
4. **Informar**: la Ley 1581 obliga al responsable (la campaña) a reportar a la SIC los incidentes de seguridad que afecten datos personales, dentro del plazo que fija su reglamentación. Verifica el plazo y el canal vigentes (Registro Nacional de Bases de Datos).
5. **Documentar** lo ocurrido y las medidas tomadas.

Define por escrito, antes del lanzamiento, quién decide cada paso y cómo se contactan.

---

## 10. Prueba de penetración

### Antes de contratarla: revisión propia
1. Escaneo automático con OWASP ZAP contra el ambiente de **pruebas** (nunca producción):
   ```bash
   docker run -t ghcr.io/zaproxy/zaproxy:stable zap-baseline.py -t https://pruebas.dominio.co
   ```
   Corregir lo que reporte como riesgo medio o alto.
2. Revisar la lista OWASP Top 10 frente al sistema (control de acceso, inyección, autenticación, configuración, componentes vulnerables).
3. Pasar las pruebas e2e de seguridad del backend.

### La prueba externa
- **Quién**: una empresa o profesional independiente con certificaciones reconocidas (por ejemplo OSCP), con contrato y acuerdo de confidencialidad. No puede ser alguien que haya construido el sistema.
- **Contra qué**: una copia exacta de producción en el ambiente de pruebas, con datos ficticios.
- **Alcance mínimo**: aplicación web, API, autenticación y doble factor, control de acceso por rol y por territorio (intentar ver datos de otro municipio), registro público, y la configuración de Cloudflare y del servidor.
- **Entregable**: informe con hallazgos clasificados por riesgo y cómo reproducirlos.
- **Después**: corregir y pedir una segunda verificación de los hallazgos altos y críticos.
- **Presupuesto**: lo paga la campaña, como ítem aparte de la propuesta.

---

## 11. Lista final antes de cargar datos reales

- [ ] Servidor con SSH por llave, sin root, firewall solo para Cloudflare
- [ ] PostgreSQL escuchando solo en localhost
- [ ] Migraciones 10 a 37 aplicadas; datos demo NO cargados
- [ ] Secretos de producción nuevos, respaldados fuera del servidor
- [ ] Doble factor activado y probado para gerente, candidato, coordinadores y administradores
- [ ] Sesión en cookies seguras (sin tokens en el navegador)
- [ ] Cloudflare en Full (strict), WAF y límites activos ([`cloudflare.md`](cloudflare.md))
- [ ] Panel administrativo solo por `admin.dominio.co` con Access; `app.dominio.co/api/usuarios` responde 403
- [ ] Cabeceras de seguridad verificadas (por ejemplo con securityheaders.com)
- [ ] Respaldo diario funcionando y **una restauración probada**
- [ ] Monitor de disponibilidad con alertas
- [ ] Política de tratamiento de datos real publicada y cargada (se ve en `/privacidad`), con `RESPONSABLE_NOMBRE`, `RESPONSABLE_CORREO` y `RESPONSABLE_TELEFONO` en el `.env`
- [ ] Plan de cierre ([`plan-cierre.md`](plan-cierre.md)) aprobado por el responsable, con fecha
- [ ] Base de datos registrada ante la SIC si la campaña está obligada (Registro Nacional de Bases de Datos)
- [ ] Prueba de penetración realizada y hallazgos altos corregidos
- [ ] Capacitación corta a líderes: no compartir cuentas, cómo reconocer mensajes falsos, qué hacer si pierden el celular
- [ ] Plan de incidentes escrito, con responsables
