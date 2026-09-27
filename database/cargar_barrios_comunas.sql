-- =============================================================================
--  cargar_barrios_comunas.sql  (paso manual, ver docs/mapas-datos.md)
--  Agrega al mapa los límites de comunas y barrios a partir de las capas
--  que entregan las alcaldías (POT) o planeación municipal.
--
--  Antes: importar las capas con importar_capa.bat (queda staging.comunas
--  y/o staging.barrios, cada una con las columnas "nombre" y "geom").
--  Uso, en psql conectado como postgres:
--    \i database/cargar_barrios_comunas.sql
--
--  - Comunas: si ya existe la comuna con ese nombre en el municipio (por
--    ejemplo "COMUNA 1 OCCIDENTAL" de Florencia), se le pone el límite; si
--    no, se crea.
--  - Barrios: quedan dentro de la comuna que los contiene o, si no hay
--    comunas con límite, del municipio.
--  El municipio se decide por ubicación (el punto interior del polígono), no
--  por el nombre. Se puede ejecutar más de una vez: actualiza sin duplicar.
-- =============================================================================

BEGIN;

INSERT INTO territorio.fuentes_geograficas (nombre, entidad)
SELECT 'Barrios y comunas (alcaldías)', 'Alcaldías municipales'
 WHERE NOT EXISTS (SELECT 1 FROM territorio.fuentes_geograficas WHERE nombre = 'Barrios y comunas (alcaldías)');

DO $$
DECLARE
    v_fuente smallint := (SELECT id FROM territorio.fuentes_geograficas WHERE nombre = 'Barrios y comunas (alcaldías)');
    v_n integer;
BEGIN
    IF to_regclass('staging.comunas') IS NOT NULL THEN
        WITH capa AS (
            SELECT upper(trim(c.nombre)) AS nombre, ST_Multi(ST_MakeValid(ST_Transform(c.geom, 4326)))::geometry(MultiPolygon, 4326) AS geom
              FROM staging.comunas c WHERE c.geom IS NOT NULL AND trim(coalesce(c.nombre, '')) <> ''
        ), ubicada AS (
            SELECT capa.*, m.id AS municipio_id
              FROM capa JOIN territorio.territorios m
                ON m.tipo_codigo = 'MUNICIPIO' AND ST_Contains(m.geom, ST_PointOnSurface(capa.geom))
        )
        INSERT INTO territorio.territorios (tipo_codigo, padre_id, nombre, geom, fuente_id)
        SELECT 'COMUNA', municipio_id, nombre, geom, v_fuente FROM ubicada
        ON CONFLICT (padre_id, tipo_codigo, nombre) DO UPDATE SET geom = EXCLUDED.geom;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        RAISE NOTICE 'Comunas cargadas o actualizadas: %', v_n;
    END IF;

    IF to_regclass('staging.barrios') IS NOT NULL THEN
        WITH capa AS (
            SELECT upper(trim(b.nombre)) AS nombre, ST_Multi(ST_MakeValid(ST_Transform(b.geom, 4326)))::geometry(MultiPolygon, 4326) AS geom
              FROM staging.barrios b WHERE b.geom IS NOT NULL AND trim(coalesce(b.nombre, '')) <> ''
        ), ubicada AS (
            SELECT DISTINCT ON (capa.nombre, m.id) capa.nombre, capa.geom,
                   coalesce((SELECT c.id FROM territorio.territorios c
                              WHERE c.tipo_codigo = 'COMUNA' AND c.padre_id = m.id AND c.geom IS NOT NULL
                                AND ST_Contains(c.geom, ST_PointOnSurface(capa.geom)) LIMIT 1), m.id) AS padre_id
              FROM capa JOIN territorio.territorios m
                ON m.tipo_codigo = 'MUNICIPIO' AND ST_Contains(m.geom, ST_PointOnSurface(capa.geom))
             ORDER BY capa.nombre, m.id, ST_Area(capa.geom) DESC
        )
        INSERT INTO territorio.territorios (tipo_codigo, padre_id, nombre, geom, fuente_id)
        SELECT 'BARRIO', padre_id, nombre, geom, v_fuente FROM ubicada
        ON CONFLICT (padre_id, tipo_codigo, nombre) DO UPDATE SET geom = EXCLUDED.geom;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        RAISE NOTICE 'Barrios cargados o actualizados: %', v_n;
    END IF;
END $$;

-- Conteos del mapa con la nueva división.
REFRESH MATERIALIZED VIEW campana.mv_conteo_territorio;

COMMIT;
