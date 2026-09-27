-- =============================================================================
--  cargar_potencial_puestos.sql  (paso manual, ver docs/mapas-datos.md)
--  Carga el potencial electoral (número de votantes habilitados) de cada
--  puesto de votación, a partir del archivo de la Registraduría (DIVIPOLE).
--  Con él, el mapa calcula la brecha: simpatizantes vs. potencial por puesto.
--
--  Uso, en psql conectado como postgres:
--    1. \i database/cargar_potencial_puestos.sql          (crea la tabla de paso)
--    2. \copy staging.potencial_puestos(municipio, puesto, potencial) FROM 'C:/ruta/potencial.csv' WITH (FORMAT csv, HEADER true, DELIMITER ';', ENCODING 'UTF8')
--       Si el CSV trae también el número de mesas (para el Día D), use:
--       \copy staging.potencial_puestos(municipio, puesto, potencial, mesas) FROM ...
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
    potencial integer,
    mesas     integer
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
    -- La jornada activa del Día D (migración 37) o, si no hay, la más reciente.
    SELECT id INTO v_jornada FROM electoral.jornadas ORDER BY (to_jsonb(jornadas) ->> 'activa')::boolean DESC NULLS LAST, fecha DESC, id DESC LIMIT 1;

    CREATE TEMP TABLE cruce ON COMMIT DROP AS
    SELECT s.municipio, s.puesto, s.potencial, s.mesas,
           (SELECT pv.id
              FROM electoral.puestos_votacion pv
              JOIN territorio.territorios m ON m.id = territorio.ancestro(pv.territorio_id, 'MUNICIPIO')
             WHERE staging.normalizar_puesto(m.nombre) = staging.normalizar_puesto(s.municipio)
               AND similarity(staging.normalizar_puesto(pv.nombre), staging.normalizar_puesto(s.puesto)) >= 0.55
             ORDER BY similarity(staging.normalizar_puesto(pv.nombre), staging.normalizar_puesto(s.puesto)) DESC
             LIMIT 1) AS puesto_id
      FROM staging.potencial_puestos s
     WHERE (s.potencial IS NOT NULL AND s.potencial >= 0) OR s.mesas > 0;

    UPDATE electoral.puestos_jornada pj
       SET potencial_electoral = coalesce(c.total, pj.potencial_electoral)
      FROM (SELECT puesto_id, sum(potencial)::integer AS total FROM cruce WHERE puesto_id IS NOT NULL GROUP BY 1) c
     WHERE pj.puesto_id = c.puesto_id AND pj.jornada_id = v_jornada;

    -- Mesas numeradas 1..n (no borra las que ya existan).
    INSERT INTO electoral.mesas (puesto_id, jornada_id, numero)
    SELECT c.puesto_id, v_jornada, n
      FROM (SELECT puesto_id, max(mesas) AS mesas FROM cruce WHERE puesto_id IS NOT NULL AND mesas > 0 GROUP BY 1) c
      JOIN electoral.puestos_jornada pj ON pj.puesto_id = c.puesto_id AND pj.jornada_id = v_jornada
     CROSS JOIN LATERAL generate_series(1, least(c.mesas, 200)) n
     WHERE NOT EXISTS (SELECT 1 FROM electoral.mesas m WHERE m.puesto_id = c.puesto_id AND m.jornada_id = v_jornada AND m.numero = n);

    RETURN QUERY
        SELECT format('Cargados: %s puestos (jornada %s)', count(DISTINCT c.puesto_id), v_jornada), NULL::text, NULL::text, NULL::integer
          FROM cruce c WHERE c.puesto_id IS NOT NULL
        UNION ALL
        SELECT 'No encontrado', c.municipio, c.puesto, c.potencial FROM cruce c WHERE c.puesto_id IS NULL;
END $$;
