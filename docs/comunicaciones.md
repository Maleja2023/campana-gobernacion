# Comunicaciones: avisos internos y mensajes a votantes

## Qué hay

| Qué | Quién lo usa | Dónde |
|---|---|---|
| **Notificaciones internas** (la campana arriba a la derecha) | Todos los usuarios | Llegan solas (ver abajo) |
| **Avisos al equipo** | Coordinadores y gerente | Comunicaciones → Avisos al equipo. Les llega a los miembros de su red que tienen usuario. |
| **Plantillas de mensajes a votantes** | Las escribe el gerente; las aprueba el candidato (o el gerente, si la escribió otra persona) | Comunicaciones → Plantillas |
| **Envíos** (SMS, correo, Telegram) | Gerente | Comunicaciones → Envíos |
| **Baja** | Cualquier votante | Enlace en cada SMS y correo (`/baja/…`), o la página `/mis-datos` |

Notificaciones automáticas:
- Nueva solicitud para ser líder o sublíder → a quien invitó.
- Nueva alerta de calidad → a quien resuelve alertas.
- Nueva solicitud de un titular de datos → a quien las tramita.
- Envío terminado → a quien lo preparó.

## Reglas que la plataforma hace cumplir

- **Solo con autorización.** A un votante le llega un mensaje solo si, al
  registrarse, marcó "Acepto recibir información de la campaña"
  (finalidad COMUNICACIONES) y no la ha revocado.
- **Baja automática.** Cada SMS y correo lleva un enlace para no recibir más
  mensajes por ese medio. Quien lo usa queda excluido de inmediato, incluso
  de envíos ya programados: justo antes de enviar cada lote se vuelve a
  revisar. También se puede pedir en `/mis-datos`.
- **Cuatro ojos.** Una plantilla la aprueba una persona distinta a quien la
  escribió. Si se edita, pierde la aprobación.
- **Borrador primero.** Un envío se prepara como borrador, que muestra a
  cuántas personas les llegará y a cuántas no (sin autorización o de
  baja), y después se programa.
- **Telegram sin datos personales.** Los mensajes de Telegram se publican
  en el **canal público de la campaña**. Recibe quien se une al canal y deja
  de recibir quien se sale. No se guarda ni se usa ningún dato de Telegram
  de las personas.

## Configurar los proveedores

Cada canal es opcional. En el `.env` de la API:

### SMS con Twilio

1. Crear la cuenta en twilio.com a nombre de la campaña, con un número o un
   *Messaging Service* habilitado para Colombia. Para envíos masivos,
   Twilio pide registrar el remitente.
2. En el `.env`:
   ```
   SMS_PROVEEDOR=twilio
   TWILIO_CUENTA_SID=AC...
   TWILIO_TOKEN=...
   SMS_REMITENTE=MG...        (o el número: +1...)
   ```
- Cada SMS de hasta 160 caracteres sin tildes cuesta un mensaje. El enlace de
  baja ocupa unos 70, así que la plataforma limita el texto a 230 (unos dos
  mensajes).
- Con tildes o ñ, cada segmento admite solo 70 caracteres, y el envío sale
  más caro. La pantalla lo advierte.

### Correo con Resend

1. Crear la cuenta en resend.com y **verificar el dominio** de la campaña
   (registros DNS SPF y DKIM en Cloudflare). Sin eso, los correos llegan a
   spam.
2. En el `.env`:
   ```
   EMAIL_PROVEEDOR=resend
   RESEND_API_KEY=re_...
   EMAIL_REMITENTE=Campaña Gobernación <noticias@dominio.co>
   ```
- El correo se pide, opcional, en el registro público.
- Cada correo lleva la cabecera `List-Unsubscribe`, que agrega el botón
  "cancelar suscripción" de Gmail y Outlook.

### Telegram

1. En Telegram, crear un **canal** público de la campaña (por ejemplo
   `@campana_caqueta`).
2. Crear un bot con **@BotFather** (`/newbot`) y copiar el token.
3. Agregar el bot como **administrador** del canal, con permiso para publicar.
4. En el `.env`:
   ```
   TELEGRAM_BOT_TOKEN=123456:ABC...
   TELEGRAM_CANAL=@campana_caqueta
   ```
5. Compartir el enlace del canal (`t.me/campana_caqueta`) en eventos, redes y
   los QR.

### Pruebas

`SMS_PROVEEDOR=consola` y `EMAIL_PROVEEDOR=consola` no envían nada: escriben
en el registro de la API solo los últimos 4 dígitos o el dominio del correo.
La API no arranca con `consola` en producción (`COOKIE_SEGURA=true`).

## Costos y buenas prácticas

- Antes de un envío grande, pruebe con un envío a un municipio pequeño.
- No envíe entre las 9 p. m. y las 7 a. m.
- Las autoridades electorales regulan la propaganda por mensajes en época de
  campaña: confirme con el asesor jurídico las fechas permitidas y el
  contenido obligatorio (por ejemplo, identificar al remitente).
