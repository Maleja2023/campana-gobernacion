-- =============================================================================
--  cargar_potencial_puestos.sql  (paso manual, ver docs/mapas-datos.md)
--  Carga el potencial electoral (número de votantes habilitados) de cada
--  puesto de votación, a partir del archivo de la Registraduría (DIVIPOLE).
--  Con él, el mapa calcula la brecha: simpatizantes vs. potencial por puesto.
--
--  Uso, en psql conectado como postgres:
--    1. \i database/cargar_potencial_puestos.sql          (crea la tabla de paso)
--    2. \copy staging.potencial_puestos(municipio, puesto, potencial) FROM 'C:/ruta/potencial.csv' WITH (FORMAT csv, HEADER true, DELIMITER ';', ENCODING 'UTF8')
--    3. SELECT * FROM staging.aplicar_potencial_puestos();
--  El paso 3 dice cuántos puestos quedaron cargados y lista los que no
--  encontró (revise que el nombre del puesto y del municipio estén bien
--  escritos). Se puede repetir cuantas veces haga falta.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS staging;

DROP TABLE IF EXISTS staging.potencial_puestos;
CREATE TABLE staging.potencial_puestos (
    municipio text,
    puesto    text,
    potencial integer
);

CREATE OR REPLACE FUNCTION staging.normalizar_puesto(p text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
    SELECT regexp_replace(upper(util.sin_tildes(trim(coalesce(p, '')))), '\s+', ' ', 'g');
$$;

CREATE OR REPLACE FUNCTION staging.aplicar_potencial_puestos()
RETURNS TABLE (resultado text, municipio text, puesto text, potencial integer)
LANGUAGE plpgsql AS $$
#variable_conflict use_column
DECLARE
    v_jornada smallint;
BEGIN
    SELECT id INTO v_jornada FROM electoral.jornadas ORDER BY fecha DESC, id DESC LIMIT 1;

    CREATE TEMP TABLE cruce ON COMMIT DROP AS
    SELECT s.municipio, s.puesto, s.potencial,
           (SELECT pv.id
              FROM electoral.puestos_votacion pv
              JOIN territorio.territorios m ON m.id = territorio.ancestro(pv.territorio_id, 'MUNICIPIO')
             WHERE staging.normalizar_puesto(m.nombre) = staging.normalizar_puesto(s.municipio)
               AND similarity(staging.normalizar_puesto(pv.nombre), staging.normalizar_puesto(s.puesto)) >= 0.55
             ORDER BY similarity(staging.normalizar_puesto(pv.nombre), staging.normalizar_puesto(s.puesto)) DESC
             LIMIT 1) AS puesto_id
      FROM staging.potencial_puestos s
     WHERE s.potencial IS NOT NULL AND s.potencial >= 0;

    UPDATE electoral.puestos_jornada pj
       SET potencial_electoral = c.total
      FROM (SELECT puesto_id, sum(potencial)::integer AS total FROM cruce WHERE puesto_id IS NOT NULL GROUP BY 1) c
     WHERE pj.puesto_id = c.puesto_id AND pj.jornada_id = v_jornada;

    RETURN QUERY
        SELECT format('Cargados: %s puestos', count(DISTINCT c.puesto_id)), NULL::text, NULL::text, NULL::integer
          FROM cruce c WHERE c.puesto_id IS NOT NULL
        UNION ALL
        SELECT 'No encontrado', c.municipio, c.puesto, c.potencial FROM cruce c WHERE c.puesto_id IS NULL;
END $$;
