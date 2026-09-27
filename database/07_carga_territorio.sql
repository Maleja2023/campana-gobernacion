-- =============================================================================
--  07_carga_territorio.sql
--  Pasa las capas de caqueta.gpkg (ya importadas en el esquema staging por
--  06_importar_gpkg.bat) a las tablas definitivas de territorio y electoral.
--
--  Requisitos: haber ejecutado 01 a 05 y 06_importar_gpkg.bat.
--  Se ejecuta UNA sola vez sobre una base recién creada. Todo va en una
--  transacción: si algo falla, no queda nada a medias.
-- =============================================================================

BEGIN;

-- Evita cargar dos veces
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM territorio.territorios) THEN
        RAISE EXCEPTION 'territorio.territorios ya tiene datos. Este script es solo para una base nueva.';
    END IF;
END $$;

-- 1. Departamento -------------------------------------------------------------
INSERT INTO territorio.territorios (tipo_codigo, padre_id, codigo_oficial, nombre, geom, fuente_id, verificado)
SELECT 'DEPARTAMENTO', NULL, d.cod_dpto, d.departamento,
       ST_Multi(d.geom),
       (SELECT id FROM territorio.fuentes_geograficas WHERE nombre = 'MGN 2025'),
       true
  FROM staging.departamento d;

-- 2. Municipios ---------------------------------------------------------------
INSERT INTO territorio.territorios (tipo_codigo, padre_id, codigo_oficial, nombre, geom, fuente_id, verificado)
SELECT 'MUNICIPIO', dep.id, m.cod_dane, m.municipio,
       ST_Multi(m.geom),
       (SELECT id FROM territorio.fuentes_geograficas WHERE nombre = 'MGN 2025'),
       true
  FROM staging.municipios m
  JOIN territorio.territorios dep
    ON dep.tipo_codigo = 'DEPARTAMENTO' AND dep.codigo_oficial = m.cod_dpto;

-- 3. Comunas y corregimientos (vienen en la Divipole, sin polígono) ----------
INSERT INTO territorio.territorios (tipo_codigo, padre_id, codigo_oficial, nombre, geom, fuente_id, verificado)
SELECT DISTINCT
       p.tipo_zona,
       mun.id,
       p.cod_dane || '-' || p.cod_zona,
       regexp_replace(p.zona, '^CORREGIMIENTO ', ''),
       NULL::geometry,
       (SELECT id FROM territorio.fuentes_geograficas WHERE nombre = 'Divipole territoriales 2023'),
       false
  FROM staging.puestos_votacion p
  JOIN territorio.territorios mun
    ON mun.tipo_codigo = 'MUNICIPIO' AND mun.codigo_oficial = p.cod_dane
 WHERE p.tipo_zona IN ('COMUNA', 'CORREGIMIENTO');

-- 4. Veredas ------------------------------------------------------------------
-- La capa de veredas del DANE junta fuentes de cada alcaldía y trae errores,
-- así que antes de cargarla se depura:
--   - Cada vereda va al municipio que contiene la mayor parte de su polígono
--     según el límite oficial del MGN (48 venían con el código de un municipio
--     vecino) y se recorta a ese límite.
--   - Se descartan los 51 polígonos "SIN DEFINIR", que no son veredas.
--   - Polígonos vecinos con el mismo nombre en un municipio son una sola vereda.
--   - Se quitan caracteres dañados del nombre ("RÍO BRAVO").
--   - Si dos veredas distintas del mismo municipio se llaman igual, se les
--     agrega el código DANE: "EL ARENOSO (18592033)".
-- (22_correccion_veredas.sql aplica este mismo bloque a una base ya cargada.)
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

INSERT INTO territorio.territorios (tipo_codigo, padre_id, codigo_oficial, nombre, geom, fuente_id, verificado)
SELECT 'VEREDA', d.municipio_id, d.codigo_ver, d.nombre, d.geom,
       (SELECT id FROM territorio.fuentes_geograficas WHERE nombre = 'Nivel de referencia de veredas'),
       false
  FROM staging.veredas_depuradas d;

-- 5. Jornada electoral de referencia -------------------------------------------
INSERT INTO electoral.jornadas (nombre, tipo_codigo, fecha)
VALUES ('Territoriales 2023', 'TERRITORIAL', '2023-10-29');

-- 6. Puestos de votación ------------------------------------------------------
-- Quedan dentro de su comuna/corregimiento si la Divipole lo indica; si no,
-- directamente en el municipio.
INSERT INTO electoral.puestos_votacion (territorio_id, nombre, direccion, geom)
SELECT COALESCE(z.id, mun.id), p.puesto, p.direccion, p.geom
  FROM staging.puestos_votacion p
  JOIN territorio.territorios mun
    ON mun.tipo_codigo = 'MUNICIPIO' AND mun.codigo_oficial = p.cod_dane
  LEFT JOIN territorio.territorios z
    ON z.tipo_codigo = p.tipo_zona AND z.codigo_oficial = p.cod_dane || '-' || p.cod_zona;

-- Todos los puestos existieron en la jornada 2023 (potencial electoral aún desconocido)
INSERT INTO electoral.puestos_jornada (puesto_id, jornada_id, potencial_electoral)
SELECT pv.id, j.id, NULL
  FROM electoral.puestos_votacion pv
 CROSS JOIN electoral.jornadas j
 WHERE j.nombre = 'Territoriales 2023';

-- En 2023 todos los puestos del Caquetá votaron gobernación
INSERT INTO electoral.puestos_jornada_corporaciones (puesto_id, jornada_id, corporacion_codigo)
SELECT pj.puesto_id, pj.jornada_id, 'GOBERNACION'
  FROM electoral.puestos_jornada pj
  JOIN electoral.puestos_votacion pv ON pv.id = pj.puesto_id
  JOIN territorio.territorios mun
    ON mun.id = territorio.ancestro(pv.territorio_id, 'MUNICIPIO')
  JOIN staging.puestos_votacion p
    ON p.cod_dane = mun.codigo_oficial AND p.puesto = pv.nombre
 WHERE p.eleccion_gobernacion::text = '1';

COMMIT;

-- Actualiza los conteos del mapa
SELECT campana.refrescar_conteos();

-- Resumen de lo cargado --------------------------------------------------------
SELECT tipo_codigo AS tipo, count(*) AS cantidad
  FROM territorio.territorios
 GROUP BY tipo_codigo
 UNION ALL
SELECT 'PUESTO_VOTACION', count(*) FROM electoral.puestos_votacion
 ORDER BY 1;

-- Para la jornada 2027: cuando la Registraduría publique la Divipole 2027,
-- se crea la jornada y se asocian los puestos vigentes, por ejemplo:
--   INSERT INTO electoral.jornadas (nombre, tipo_codigo, fecha)
--   VALUES ('Territoriales 2027', 'TERRITORIAL', '<fecha oficial>');
