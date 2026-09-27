-- ============================================================================
-- CIERRE DE LA CAMPAÑA: eliminación definitiva de los datos personales
-- ============================================================================
-- Ejecutar SOLO al terminar la campaña, siguiendo docs/plan-cierre.md, después
-- de la entrega (si la hay) y con el acta firmada. NO es una migración: no lo
-- corra con las demás.
--
-- Qué hace, en una sola transacción:
--   1. Guarda en el esquema "cierre" solo cifras agregadas, que no identifican
--      a nadie:
--      - simpatizantes por municipio;
--      - simpatizantes por puesto de votación, solo donde hay 10 o más;
--      - necesidades por municipio y categoría;
--      - resultados E-14, que son públicos.
--   2. Vacía (TRUNCATE) todas las tablas con datos de personas o de usuarios:
--      - personas, teléfonos, correos, simpatizantes, red y enlaces;
--      - autorizaciones, solicitudes, eventos y asistencias, necesidades;
--      - comunicaciones, conversaciones del chat, usuarios y sesiones, E-14;
--      - la bitácora de auditoría (guarda correos de usuarios e IP).
--   3. Deja un acta en cierre.acta con cuántos registros se eliminaron.
--
-- Se conservan: el territorio (mapas), los catálogos, los puestos de votación
-- y el esquema "cierre".
--
-- Uso, en psql como postgres (la confirmación es obligatoria):
--   psql -d campana_gobernacion -v confirmar=ELIMINAR-DATOS-PERSONALES -f database/cierre_campana.sql
--
-- Después: borrar LLAVE_CIFRADO y PEPPER_HMAC de todas partes y destruir los
-- respaldos (ver el plan). Sin la llave, cualquier copia que haya quedado de la
-- base tiene cédulas y teléfonos ilegibles.
-- ============================================================================

\set ON_ERROR_STOP on

\if :{?confirmar}
\else
  \echo 'Falta la confirmación: -v confirmar=ELIMINAR-DATOS-PERSONALES'
  \quit
\endif

SELECT :'confirmar' = 'ELIMINAR-DATOS-PERSONALES' AS confirmado \gset
\if :confirmado
\else
  \echo 'La confirmación no coincide. No se borró nada.'
  \quit
\endif

BEGIN;

CREATE SCHEMA IF NOT EXISTS cierre;
REVOKE ALL ON SCHEMA cierre FROM PUBLIC;

-- 1. Cifras agregadas -------------------------------------------------------

DROP TABLE IF EXISTS cierre.simpatizantes_municipio, cierre.simpatizantes_puesto,
  cierre.necesidades_municipio, cierre.resultados_e14;

CREATE TABLE cierre.simpatizantes_municipio AS
SELECT j.municipio_id, m.nombre AS municipio,
       count(*) AS simpatizantes,
       count(*) FILTER (WHERE s.estado_codigo = 'ACTIVO') AS activos
  FROM campana.simpatizantes s
  JOIN territorio.v_jerarquia j ON j.id = s.territorio_residencia_id
  JOIN territorio.territorios m ON m.id = j.municipio_id
 GROUP BY 1, 2;

-- Con menos de 10 por puesto, la cifra podría señalar a personas concretas.
CREATE TABLE cierre.simpatizantes_puesto AS
SELECT sp.jornada_id, sp.puesto_id, count(*) AS simpatizantes
  FROM campana.simpatizante_puesto sp
 GROUP BY 1, 2
HAVING count(*) >= 10;

CREATE TABLE cierre.necesidades_municipio AS
SELECT municipio_id, categoria_codigo, cantidad
  FROM participacion.v_necesidades_municipio;

CREATE TABLE cierre.resultados_e14 AS
SELECT f.mesa_id, f.corporacion_codigo, r.opcion_voto_id, r.votos
  FROM electoral.resultados_e14 r
  JOIN electoral.formularios_e14 f ON f.id = r.formulario_id;

CREATE TABLE IF NOT EXISTS cierre.acta (
  id             serial PRIMARY KEY,
  ejecutado_en   timestamptz NOT NULL DEFAULT now(),
  ejecutado_por  text NOT NULL DEFAULT current_user,
  eliminados     jsonb NOT NULL
);

-- 2. Conteo de lo que se elimina, para el acta ------------------------------

CREATE TEMP TABLE conteo_cierre (tabla text, filas bigint) ON COMMIT DROP;
DO $$
DECLARE
  t text;
  n bigint;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'personas.personas', 'personas.telefonos', 'personas.correos',
    'campana.simpatizantes', 'campana.miembros', 'campana.links_referido', 'campana.solicitudes_lider',
    'cumplimiento.autorizaciones', 'cumplimiento.solicitudes_titular',
    'participacion.necesidades', 'eventos.eventos', 'eventos.asistencias',
    'comunicaciones.envio_destinatarios', 'comunicaciones.bajas', 'chatbot.conversaciones',
    'acceso.usuarios', 'electoral.formularios_e14', 'auditoria.eventos', 'auditoria.exportaciones'
  ] LOOP
    IF to_regclass(t) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM %s', t) INTO n;
      INSERT INTO conteo_cierre VALUES (t, n);
    END IF;
  END LOOP;
END $$;

-- 3. Eliminación -------------------------------------------------------------
-- TRUNCATE ... CASCADE vacía también todas las tablas que dependen de estas
-- (historial, metas, alertas, sesiones, MFA, resultados, etc.).

TRUNCATE
  personas.personas,
  acceso.usuarios,
  campana.miembros,
  campana.links_referido,
  eventos.eventos,
  participacion.necesidades,
  comunicaciones.envios,
  comunicaciones.notificaciones,
  chatbot.conversaciones,
  electoral.formularios_e14,
  electoral.testigos,
  auditoria.eventos,
  auditoria.exportaciones
CASCADE;

INSERT INTO cierre.acta (eliminados)
SELECT jsonb_object_agg(tabla, filas) FROM conteo_cierre;

-- Comprobación: no puede quedar ninguna persona.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM personas.personas) OR EXISTS (SELECT 1 FROM acceso.usuarios) THEN
    RAISE EXCEPTION 'Quedaron datos personales; se deshace todo';
  END IF;
END $$;

COMMIT;

\echo ''
\echo 'Datos personales eliminados. Acta:'
SELECT id, ejecutado_en, ejecutado_por, jsonb_pretty(eliminados) AS eliminados FROM cierre.acta ORDER BY id DESC LIMIT 1;
\echo 'Siga con el paso 5 de docs/plan-cierre.md (llaves y respaldos).'
