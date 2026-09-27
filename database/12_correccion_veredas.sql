-- =============================================================================
--  12_correccion_veredas.sql
--  Corrige las veredas en una base que ya se cargó con la versión anterior de
--  07_carga_territorio.sql. Esa versión tomaba la capa de veredas del DANE tal
--  como venía y por eso:
--    1. 48 veredas quedaban en un municipio distinto al que las contiene
--       (ej.: BERLÍN y ALEMANIA figuraban en El Doncello pero están dentro
--       de Puerto Rico según el límite municipal oficial del MGN).
--    2. Había 51 polígonos llamados "SIN DEFINIR", que no son veredas.
--    3. La misma vereda aparecía dos veces (ASTILLA y LA ASTILLA en Florencia).
--    4. Un nombre venía dañado (RÍO BRAVO traía un carácter invisible).
--  Además, cada polígono se recorta al límite de su municipio.
--
--  Qué hace con lo que ya está registrado (simpatizantes, necesidades, eventos,
--  metas, asignaciones de usuarios):
--    - Si estaba en una vereda que cambia de municipio, sigue en la misma
--      vereda (ahora bajo el municipio correcto).
--    - Si estaba en una vereda duplicada, pasa a la vereda que se conserva.
--    - Si estaba en un "SIN DEFINIR", pasa al municipio donde queda ese polígono.
--
--  Requiere: 01 a 07 y el esquema staging que deja 06_importar_gpkg.bat.
--  Todo va en una transacción: si algo falla, no cambia nada.
--  Se puede ejecutar más de una vez (la segunda vez no cambia nada).
-- =============================================================================

BEGIN;

DO $$
BEGIN
    IF to_regclass('staging.veredas') IS NULL THEN
        RAISE EXCEPTION 'No existe staging.veredas. Ejecuta primero 06_importar_gpkg.bat.';
    END IF;
END $$;

-- 1. Veredas depuradas (el mismo bloque que usa 07_carga_territorio.sql) ------
DROP TABLE IF EXISTS staging.veredas_depuradas;
CREATE TABLE staging.veredas_depuradas AS
WITH base AS (
    -- Nombre limpio (sin caracteres de control) y sin los "SIN DEFINIR"
    SELECT v.codigo_ver,
           util.normalizar_nombre(regexp_replace(v.nombre_ver, '[\u0080-\u009F]', '', 'g')) AS nombre,
           ST_CollectionExtract(ST_MakeValid(v.geom), 3) AS geom
      FROM staging.veredas v
     WHERE util.normalizar_nombre(v.nombre_ver) NOT IN ('', 'SIN DEFINIR')
),
asignada AS (
    -- Cada vereda va al municipio que contiene la mayor parte de su polígono,
    -- recortada a ese límite municipal.
    SELECT DISTINCT ON (b.codigo_ver)
           b.codigo_ver, b.nombre, m.id AS municipio_id,
           ST_CollectionExtract(ST_Intersection(b.geom, m.geom), 3) AS geom
      FROM base b
      JOIN territorio.territorios m
        ON m.tipo_codigo = 'MUNICIPIO' AND ST_Intersects(b.geom, m.geom)
     ORDER BY b.codigo_ver, ST_Area(ST_Intersection(b.geom, m.geom)) DESC
),
agrupada AS (
    -- Dos polígonos vecinos del mismo municipio con el mismo nombre (sin
    -- contar tildes, espacios ni el artículo) son una sola vereda.
    SELECT a.*,
           ST_ClusterDBSCAN(a.geom, 0, 1) OVER (
               PARTITION BY a.municipio_id,
                            regexp_replace(regexp_replace(util.sin_tildes(a.nombre),
                                           '^(EL|LA|LOS|LAS) ', ''), '[^A-Z0-9]', '', 'g')
           ) AS grupo,
           regexp_replace(regexp_replace(util.sin_tildes(a.nombre),
                          '^(EL|LA|LOS|LAS) ', ''), '[^A-Z0-9]', '', 'g') AS clave
      FROM asignada a
     WHERE NOT ST_IsEmpty(a.geom)
),
unida AS (
    -- Se conserva el código y el nombre del polígono más grande
    SELECT (array_agg(codigo_ver ORDER BY ST_Area(geom) DESC))[1] AS codigo_ver,
           (array_agg(nombre     ORDER BY ST_Area(geom) DESC))[1] AS nombre,
           municipio_id,
           ST_Multi(ST_Union(geom)) AS geom,
           array_agg(codigo_ver) AS codigos_origen
      FROM agrupada
     GROUP BY municipio_id, clave, grupo
)
-- Nombres que se repiten en un municipio llevan el código DANE para distinguirse
SELECT codigo_ver, municipio_id, codigos_origen, geom,
       CASE WHEN count(*) OVER (PARTITION BY municipio_id, nombre) > 1
            THEN nombre || ' (' || codigo_ver || ')'
            ELSE nombre END AS nombre
  FROM unida;

-- 2. Qué pasa con cada vereda que ya está en la base --------------------------
CREATE TEMP TABLE reemplazo ON COMMIT DROP AS
-- Duplicadas: pasan a la vereda que se conserva
SELECT t.id AS viejo_id, n.id AS nuevo_id
  FROM territorio.territorios t
  JOIN staging.veredas_depuradas d
    ON t.codigo_oficial = ANY (d.codigos_origen) AND t.codigo_oficial <> d.codigo_ver
  JOIN territorio.territorios n
    ON n.tipo_codigo = 'VEREDA' AND n.codigo_oficial = d.codigo_ver
 WHERE t.tipo_codigo = 'VEREDA'
UNION ALL
-- "SIN DEFINIR": pasan al municipio que contiene la mayor parte del polígono
(SELECT DISTINCT ON (t.id) t.id, m.id
  FROM territorio.territorios t
  JOIN staging.veredas v ON v.codigo_ver = t.codigo_oficial
  JOIN territorio.territorios m
    ON m.tipo_codigo = 'MUNICIPIO' AND ST_Intersects(t.geom, m.geom)
 WHERE t.tipo_codigo = 'VEREDA'
   AND NOT EXISTS (SELECT 1 FROM staging.veredas_depuradas d
                    WHERE t.codigo_oficial = ANY (d.codigos_origen))
 ORDER BY t.id, ST_Area(ST_Intersection(ST_MakeValid(t.geom), m.geom)) DESC);

-- 3. Pasar todo lo que apunta a esas veredas a su reemplazo -------------------
--    Se recorren todas las tablas con llave foránea a territorio.territorios.
--    Si la fila ya existe con el reemplazo (ej.: el usuario ya tenía asignado
--    ese municipio), se borra la repetida en vez de duplicarla.
DO $$
DECLARE
    v_fk      record;
    v_otras   text;
    v_n       bigint;
BEGIN
    FOR v_fk IN
        SELECT c.conrelid::regclass AS tabla, a.attname AS columna, a.attnum, c.conrelid
          FROM pg_constraint c
          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
         WHERE c.contype = 'f' AND c.confrelid = 'territorio.territorios'::regclass
    LOOP
        -- Demás columnas de la llave única o primaria que incluye esta columna
        SELECT string_agg(format('y.%1$I IS NOT DISTINCT FROM x.%1$I', o.attname), ' AND ')
          INTO v_otras
          FROM pg_constraint u
          JOIN pg_attribute o ON o.attrelid = u.conrelid AND o.attnum = ANY (u.conkey)
         WHERE u.conrelid = v_fk.conrelid AND u.contype IN ('p', 'u')
           AND v_fk.attnum = ANY (u.conkey) AND o.attnum <> v_fk.attnum;

        IF v_otras IS NOT NULL THEN
            EXECUTE format(
                'DELETE FROM %1$s x USING reemplazo r
                  WHERE x.%2$I = r.viejo_id
                    AND EXISTS (SELECT 1 FROM %1$s y
                                 WHERE (y.%2$I = r.nuevo_id
                                        OR (y.%2$I IN (SELECT viejo_id FROM reemplazo r2
                                                        WHERE r2.nuevo_id = r.nuevo_id)
                                            AND y.ctid < x.ctid))
                                   AND %3$s)',
                v_fk.tabla, v_fk.columna, v_otras);
        END IF;

        EXECUTE format('UPDATE %1$s x SET %2$I = r.nuevo_id FROM reemplazo r WHERE x.%2$I = r.viejo_id',
                       v_fk.tabla, v_fk.columna);
        GET DIAGNOSTICS v_n = ROW_COUNT;
        IF v_n > 0 THEN
            RAISE NOTICE '%.%: % filas movidas', v_fk.tabla, v_fk.columna, v_n;
        END IF;
    END LOOP;
END $$;

-- El nombre de la vereda duplicada queda como nombre alterno de la que se conserva
INSERT INTO territorio.nombres_alternos (territorio_id, nombre)
SELECT r.nuevo_id, t.nombre
  FROM reemplazo r
  JOIN territorio.territorios t ON t.id = r.viejo_id
  JOIN territorio.territorios n ON n.id = r.nuevo_id AND n.tipo_codigo = 'VEREDA'
    ON CONFLICT DO NOTHING;

DELETE FROM territorio.territorios t USING reemplazo r WHERE t.id = r.viejo_id;

-- 4. Municipio, polígono y nombre correctos para las veredas que quedan -------
--    Primero un nombre provisional único para no chocar con uq_territorio_nombre
--    mientras se actualizan.
UPDATE territorio.territorios t
   SET nombre = t.nombre || ' #' || t.id
  FROM staging.veredas_depuradas d
 WHERE t.tipo_codigo = 'VEREDA' AND t.codigo_oficial = d.codigo_ver
   AND (t.nombre, t.padre_id) IS DISTINCT FROM (d.nombre, d.municipio_id);

UPDATE territorio.territorios t
   SET padre_id = d.municipio_id,
       nombre   = d.nombre,
       geom     = d.geom
  FROM staging.veredas_depuradas d
 WHERE t.tipo_codigo = 'VEREDA' AND t.codigo_oficial = d.codigo_ver
   AND (t.nombre, t.padre_id, ST_AsBinary(t.geom))
       IS DISTINCT FROM (d.nombre, d.municipio_id, ST_AsBinary(d.geom));

COMMIT;

-- Actualiza los conteos del mapa
SELECT campana.refrescar_conteos();

-- Resumen: veredas por municipio
SELECT m.nombre AS municipio, count(v.id) AS veredas
  FROM territorio.territorios m
  LEFT JOIN territorio.territorios v ON v.padre_id = m.id AND v.tipo_codigo = 'VEREDA'
 WHERE m.tipo_codigo = 'MUNICIPIO'
 GROUP BY m.nombre
 ORDER BY m.nombre;
