#!/bin/bash
# Respaldo diario cifrado de la base de datos, con copia fuera del servidor.
#
# Uso (cron, 2:00 a. m., como el usuario del sistema "postgres"):
#   0 2 * * * /opt/campana/scripts/respaldo.sh >> /var/log/campana-respaldo.log 2>&1
#
# Configuración en /etc/campana/respaldo.env (permisos 600):
#   BASE=campana_gobernacion
#   DESTINO=/var/backups/campana
#   AGE_DESTINATARIO=age1...      # llave PÚBLICA. La privada NO va en el servidor.
#   RCLONE_REMOTO=remoto:respaldos-campana   # otro proveedor (Backblaze B2, S3, etc.)
#   AVISO_URL=https://hc-ping.com/<id>       # opcional: avisa si el respaldo no corre
#   E14_DIRECTORIO=/opt/campana/almacen/e14  # opcional: fotos de los E-14 (Día D)
#
# Necesita: pg_dump, age (https://age-encryption.org), rclone y sha256sum.
set -euo pipefail
umask 077

CONFIG=${CONFIG:-/etc/campana/respaldo.env}
# shellcheck source=/dev/null
source "$CONFIG"
: "${BASE:?falta BASE}" "${DESTINO:?falta DESTINO}" "${AGE_DESTINATARIO:?falta AGE_DESTINATARIO}" "${RCLONE_REMOTO:?falta RCLONE_REMOTO}"

avisar() { [ -n "${AVISO_URL:-}" ] && curl -fsS -m 10 --retry 3 "$AVISO_URL$1" > /dev/null || true; }
trap 'avisar /fail; echo "$(date -Is) ERROR: el respaldo falló"' ERR

FECHA=$(date +%F)
mkdir -p "$DESTINO/diario" "$DESTINO/semanal"
ARCHIVO="$DESTINO/diario/campana-$FECHA.dump.age"
avisar /start

# Base completa en formato custom (permite restaurar tablas sueltas), cifrada
# en el mismo paso: el volcado sin cifrar nunca toca el disco.
pg_dump -Fc -d "$BASE" | age -r "$AGE_DESTINATARIO" > "$ARCHIVO.tmp"
# Roles y permisos (sin ellos la restauración no queda igual).
pg_dumpall --globals-only | age -r "$AGE_DESTINATARIO" > "$DESTINO/diario/globales-$FECHA.sql.age"
mv "$ARCHIVO.tmp" "$ARCHIVO"
# Fotos de los E-14, si las hay.
if [ -n "${E14_DIRECTORIO:-}" ] && [ -d "$E14_DIRECTORIO" ]; then
  tar -C "$E14_DIRECTORIO" -cf - . | age -r "$AGE_DESTINATARIO" > "$DESTINO/diario/e14-$FECHA.tar.age"
fi

TAMANO=$(stat -c %s "$ARCHIVO")
if [ "$TAMANO" -lt 10240 ]; then
  echo "$(date -Is) ERROR: el respaldo pesa $TAMANO bytes; algo salió mal" >&2
  false
fi
( cd "$DESTINO/diario" && sha256sum campana-"$FECHA".dump.age globales-"$FECHA".sql.age $(ls e14-"$FECHA".tar.age 2>/dev/null) > "campana-$FECHA.sha256" )

# Los domingos, una copia semanal.
if [ "$(date +%u)" = 7 ]; then
  cp "$DESTINO/diario/"*"-$FECHA"* "$DESTINO/semanal/"
fi

# Copia fuera del servidor. "copy" nunca borra en el remoto: la retención del
# remoto se configura en el proveedor (reglas de ciclo de vida).
rclone copy "$DESTINO/diario" "$RCLONE_REMOTO/diario" --include "*-$FECHA*"
if [ "$(date +%u)" = 7 ]; then
  rclone copy "$DESTINO/semanal" "$RCLONE_REMOTO/semanal" --include "*-$FECHA*"
fi
rclone check "$DESTINO/diario" "$RCLONE_REMOTO/diario" --include "*-$FECHA*" --one-way

# Retención local: 14 diarios y 8 semanales.
find "$DESTINO/diario" -type f -mtime +14 -delete
find "$DESTINO/semanal" -type f -mtime +56 -delete

echo "$(date -Is) OK: $ARCHIVO ($TAMANO bytes) copiado a $RCLONE_REMOTO"
avisar ""
