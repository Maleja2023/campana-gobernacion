#!/bin/bash
# Prueba de restauración: descarga el último respaldo, lo descifra, lo restaura
# en una base temporal y verifica que los datos sirven (incluido descifrar
# cédulas y teléfonos con la llave de la aplicación).
#
# Córrala una vez al mes en un servidor TEMPORAL (nunca en producción), como
# un usuario con permiso de crear bases en PostgreSQL:
#   ./probar_restauracion.sh <llave-privada-age> <archivo .env de producción> [respaldo.dump.age]
#
# - La llave privada age y el .env salen del gestor de contraseñas solo para
#   esta prueba. Bórrelos del servidor temporal al terminar.
# - Sin el tercer argumento, descarga el más reciente de RCLONE_REMOTO.
# - Al final borra la base temporal y el volcado descifrado.
#
# Necesita: psql, pg_restore, age, rclone (si descarga) y node.
set -euo pipefail
umask 077

LLAVE=${1:?"uso: $0 <llave-privada-age> <.env> [respaldo]"}
ENV_APP=${2:?"uso: $0 <llave-privada-age> <.env> [respaldo]"}
RESPALDO=${3:-}
RCLONE_REMOTO=${RCLONE_REMOTO:-remoto:respaldos-campana}
TRABAJO=$(mktemp -d)
BASE_PRUEBA="restauracion_prueba_$(date +%Y%m%d_%H%M)"

limpiar() {
  dropdb --if-exists "$BASE_PRUEBA" 2>/dev/null || true
  rm -rf "$TRABAJO"
}
trap limpiar EXIT

if [ -z "$RESPALDO" ]; then
  ULTIMO=$(rclone lsf "$RCLONE_REMOTO/diario" --include 'campana-*.dump.age' | sort | tail -1)
  [ -n "$ULTIMO" ] || { echo "No hay respaldos en $RCLONE_REMOTO/diario"; exit 1; }
  echo "Descargando $ULTIMO..."
  rclone copy "$RCLONE_REMOTO/diario/$ULTIMO" "$TRABAJO/"
  rclone copy "$RCLONE_REMOTO/diario/${ULTIMO%.dump.age}.sha256" "$TRABAJO/" 2>/dev/null || true
  RESPALDO="$TRABAJO/$ULTIMO"
  if [ -f "$TRABAJO/${ULTIMO%.dump.age}.sha256" ]; then
    ( cd "$TRABAJO" && grep "$ULTIMO" "${ULTIMO%.dump.age}.sha256" | sha256sum -c - )
  fi
fi

echo "1/4 Descifrando $(basename "$RESPALDO")..."
age -d -i "$LLAVE" -o "$TRABAJO/base.dump" "$RESPALDO"

echo "2/4 Restaurando en la base temporal $BASE_PRUEBA..."
createdb "$BASE_PRUEBA"
psql -q -d "$BASE_PRUEBA" -c 'CREATE EXTENSION IF NOT EXISTS postgis' > /dev/null
# --no-owner: el servidor temporal puede no tener los mismos roles.
pg_restore --no-owner --no-acl --exit-on-error -d "$BASE_PRUEBA" "$TRABAJO/base.dump" 2>&1 \
  | grep -v 'already exists' || true

echo "3/4 Contando registros..."
psql -d "$BASE_PRUEBA" -v ON_ERROR_STOP=1 -P pager=off -c "
  SELECT 'personas' AS tabla, count(*) FROM personas.personas
  UNION ALL SELECT 'simpatizantes', count(*) FROM campana.simpatizantes
  UNION ALL SELECT 'miembros de la red', count(*) FROM campana.miembros
  UNION ALL SELECT 'usuarios', count(*) FROM acceso.usuarios
  UNION ALL SELECT 'eventos de auditoría', count(*) FROM auditoria.eventos
  UNION ALL SELECT 'territorios (municipios, veredas...)', count(*) FROM territorio.territorios;"

echo "4/4 Descifrando una muestra de cédulas y teléfonos con la llave de la aplicación..."
LLAVE_CIFRADO=$(grep -E '^LLAVE_CIFRADO=' "$ENV_APP" | cut -d= -f2- | tr -d '"' | tr -d "'")
[ -n "$LLAVE_CIFRADO" ] || { echo "El .env no tiene LLAVE_CIFRADO"; exit 1; }
MUESTRA=$(psql -d "$BASE_PRUEBA" -Atc "
  (SELECT encode(documento_cifrado, 'hex') FROM personas.personas WHERE get_byte(documento_cifrado, 0) = 1 ORDER BY random() LIMIT 20)
  UNION ALL
  (SELECT encode(telefono_cifrado, 'hex') FROM personas.telefonos WHERE get_byte(telefono_cifrado, 0) = 1 ORDER BY random() LIMIT 20)")
if [ -z "$MUESTRA" ]; then
  echo "   (la base no tiene datos cifrados todavía)"
else
  echo "$MUESTRA" | LLAVE_CIFRADO="$LLAVE_CIFRADO" node -e '
    const crypto = require("node:crypto");
    const llave = Buffer.from(process.env.LLAVE_CIFRADO, "base64");
    let ok = 0, mal = 0;
    for (const linea of require("fs").readFileSync(0, "utf8").split("\n").filter(Boolean)) {
      const b = Buffer.from(linea, "hex");
      try {
        const d = crypto.createDecipheriv("aes-256-gcm", llave, b.subarray(1, 13));
        d.setAuthTag(b.subarray(13, 29));
        Buffer.concat([d.update(b.subarray(29)), d.final()]);
        ok++;
      } catch { mal++; }
    }
    console.log(`   ${ok} descifrados bien, ${mal} con error`);
    process.exit(mal > 0 || ok === 0 ? 1 : 0);'
fi

echo
echo "RESTAURACIÓN PROBADA: $(date -Is), respaldo $(basename "$RESPALDO")."
echo "Anote la fecha y el resultado en la bitácora de respaldos."
