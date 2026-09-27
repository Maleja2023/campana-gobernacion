-- =============================================================================
--  29_mapas.sql
--  Funciones del mapa territorial:
--    - Conteo de simpatizantes por zona con filtros por líder o coordinador
--      (su red completa) y por rango de fechas de captura.
--    - Mapa de calor de registros.
--    - Capa de necesidades por sector (con la categoría de la IA si no la
--      tiene de origen).
--    - Brecha electoral por puesto: simpatizantes vs. potencial de votantes.
--
--  Todas son SECURITY INVOKER: la seguridad por fila decide qué
--  simpatizantes cuenta cada usuario (el coordinador, solo los de su red).
--  Las fechas se toman en hora de Colombia.
--
--  Requiere: 01 a 28. Se puede ejecutar más de una vez.
-- =============================================================================

BEGIN;

-- Links de la red de un miembro (él y todos los que están bajo él). Vacío si
-- el miembro no es visible para el usuario: filtrar por un líder ajeno no
-- revela nada.
CREATE OR REPLACE FUNCTION campana.links_de_red(p_miembro_id uuid)
RETURNS TABLE (link_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
    SELECT l.id
      FROM campana.subordinados(p_miembro_id) s
      JOIN campana.links_referido l ON l.miembro_id = s.miembro_id
     WHERE p_miembro_id IN (SELECT miembro_id FROM campana.miembros_visibles());
$$;
REVOKE EXECUTE ON FUNCTION campana.links_de_red(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION campana.links_de_red(uuid) TO rol_app;

-- Simpatizantes activos que cumplen los filtros (y que el usuario puede ver).
CREATE OR REPLACE FUNCTION campana.simpatizantes_filtrados(p_miembro_id uuid, p_desde date, p_hasta date)
RETURNS TABLE (persona_id uuid, territorio_residencia_id integer, ubicacion geometry)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
    SELECT s.persona_id, s.territorio_residencia_id, s.ubicacion
      FROM campana.simpatizantes s
     WHERE s.estado_codigo = 'ACTIVO'
       AND (p_miembro_id IS NULL OR s.link_referido_id IN (SELECT link_id FROM campana.links_de_red(p_miembro_id)))
       AND (p_desde IS NULL OR (s.capturado_en AT TIME ZONE 'America/Bogota')::date >= p_desde)
       AND (p_hasta IS NULL OR (s.capturado_en AT TIME ZONE 'America/Bogota')::date <= p_hasta);
$$;
GRANT EXECUTE ON FUNCTION campana.simpatizantes_filtrados(uuid, date, date) TO rol_app;

-- Simpatizantes por cada hijo de p_padre_id (y el total del propio padre).
CREATE OR REPLACE FUNCTION campana.mapa_conteos(p_padre_id integer, p_miembro_id uuid, p_desde date, p_hasta date)
RETURNS TABLE (territorio_id integer, simpatizantes integer)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
    WITH zonas AS (
        SELECT id FROM territorio.territorios WHERE padre_id = p_padre_id
        UNION ALL SELECT p_padre_id
    ), contenido AS (
        SELECT z.id AS zona, d.territorio_id
          FROM zonas z CROSS JOIN LATERAL territorio.descendientes(z.id) d
    ), por_territorio AS (
        SELECT f.territorio_residencia_id AS territorio_id, count(*) AS n
          FROM campana.simpatizantes_filtrados(p_miembro_id, p_desde, p_hasta) f
         GROUP BY 1
    )
    SELECT c.zona, coalesce(sum(p.n), 0)::integer
      FROM contenido c LEFT JOIN por_territorio p ON p.territorio_id = c.territorio_id
     GROUP BY c.zona;
$$;
GRANT EXECUTE ON FUNCTION campana.mapa_conteos(integer, uuid, date, date) TO rol_app;

-- Punto que representa un territorio en el mapa: dentro de su polígono o, si
-- no lo tiene (comunas y corregimientos sin límite oficial), del ancestro
-- más cercano que sí lo tenga.
CREATE OR REPLACE FUNCTION territorio.punto_representativo(p_territorio_id integer) RETURNS geometry
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
    WITH RECURSIVE subida AS (
        SELECT t.id, t.padre_id, t.geom, 0 AS nivel FROM territorio.territorios t WHERE t.id = p_territorio_id
        UNION ALL
        SELECT p.id, p.padre_id, p.geom, s.nivel + 1 FROM territorio.territorios p JOIN subida s ON p.id = s.padre_id
    )
    SELECT ST_PointOnSurface(geom) FROM subida WHERE geom IS NOT NULL ORDER BY nivel LIMIT 1;
$$;

-- Mapa de calor: puntos con peso. La ubicación GPS del registro (si la hay)
-- se redondea a ~100 m; sin GPS, cuenta en el punto de su vereda o barrio.
CREATE OR REPLACE FUNCTION campana.mapa_calor(p_municipio_id integer, p_miembro_id uuid, p_desde date, p_hasta date)
RETURNS TABLE (lat double precision, lon double precision, peso integer)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
    WITH f AS (
        SELECT * FROM campana.simpatizantes_filtrados(p_miembro_id, p_desde, p_hasta)
         WHERE p_municipio_id IS NULL
            OR territorio_residencia_id IN (SELECT territorio_id FROM territorio.descendientes(p_municipio_id))
    ), puntos AS (
        SELECT ST_SnapToGrid(ubicacion, 0.001) AS g, count(*) AS n FROM f WHERE ubicacion IS NOT NULL GROUP BY 1
        UNION ALL
        SELECT territorio.punto_representativo(t.territorio_residencia_id), t.n
          FROM (SELECT territorio_residencia_id, count(*) AS n FROM f WHERE ubicacion IS NULL GROUP BY 1) t
    )
    SELECT ST_Y(g), ST_X(g), sum(n)::integer FROM puntos WHERE g IS NOT NULL GROUP BY g;
$$;
GRANT EXECUTE ON FUNCTION campana.mapa_calor(integer, uuid, date, date) TO rol_app;

-- Necesidades por cada hijo de p_padre_id, con su reparto por categoría.
CREATE OR REPLACE FUNCTION participacion.mapa_necesidades(p_padre_id integer, p_categoria text)
RETURNS TABLE (territorio_id integer, total integer, por_categoria json)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
    WITH zonas AS (
        SELECT id FROM territorio.territorios WHERE padre_id = p_padre_id
    ), contenido AS (
        SELECT z.id AS zona, d.territorio_id
          FROM zonas z CROSS JOIN LATERAL territorio.descendientes(z.id) d
    ), categorizada AS (
        SELECT n.territorio_id,
               coalesce(n.categoria_codigo,
                        (SELECT c.categoria_codigo FROM participacion.clasificaciones_ia c
                          WHERE c.necesidad_id = n.id ORDER BY c.clasificada_en DESC, c.confianza DESC LIMIT 1),
                        'OTRA') AS categoria
          FROM participacion.necesidades n
    ), por_zona AS (
        SELECT c.zona, k.categoria, count(*) AS n
          FROM contenido c JOIN categorizada k ON k.territorio_id = c.territorio_id
         WHERE p_categoria IS NULL OR k.categoria = p_categoria
         GROUP BY 1, 2
    )
    SELECT zona, sum(n)::integer, json_object_agg(categoria, n)
      FROM por_zona GROUP BY zona;
$$;
GRANT EXECUTE ON FUNCTION participacion.mapa_necesidades(integer, text) TO rol_app;

-- Brecha electoral por puesto de la jornada vigente: simpatizantes que votan
-- allí (con los filtros) frente a su potencial electoral.
CREATE OR REPLACE FUNCTION campana.brecha_puestos(p_municipio_id integer, p_miembro_id uuid, p_desde date, p_hasta date)
RETURNS TABLE (puesto_id integer, puesto text, municipio_id integer, municipio text,
               potencial_electoral integer, simpatizantes integer, cobertura_pct numeric, lat double precision, lon double precision)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
    WITH jornada AS (SELECT id FROM electoral.jornadas ORDER BY fecha DESC, id DESC LIMIT 1),
    f AS (SELECT persona_id FROM campana.simpatizantes_filtrados(p_miembro_id, p_desde, p_hasta))
    SELECT pv.id, pv.nombre, m.id, m.nombre, pj.potencial_electoral,
           count(f.persona_id)::integer,
           CASE WHEN pj.potencial_electoral > 0
                THEN round(100.0 * count(f.persona_id) / pj.potencial_electoral, 1) END,
           ST_Y(pv.geom), ST_X(pv.geom)
      FROM electoral.puestos_votacion pv
      JOIN jornada j ON true
      JOIN electoral.puestos_jornada pj ON pj.puesto_id = pv.id AND pj.jornada_id = j.id
      JOIN territorio.territorios m ON m.id = territorio.ancestro(pv.territorio_id, 'MUNICIPIO')
      LEFT JOIN campana.simpatizante_puesto sp ON sp.puesto_id = pv.id AND sp.jornada_id = j.id
      LEFT JOIN f ON f.persona_id = sp.persona_id
     WHERE p_municipio_id IS NULL OR m.id = p_municipio_id
     GROUP BY pv.id, pv.nombre, m.id, m.nombre, pj.potencial_electoral, pv.geom;
$$;
GRANT EXECUTE ON FUNCTION campana.brecha_puestos(integer, uuid, date, date) TO rol_app;

-- Miembros que el usuario puede usar como filtro (coordinadores y líderes).
CREATE OR REPLACE FUNCTION campana.miembros_para_filtro()
RETURNS TABLE (miembro_id uuid, nombre text, cargo_codigo text, municipio text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
    SELECT m.id, p.nombres || ' ' || p.apellidos, m.cargo_codigo, campana.municipio_de_miembro(m.id)
      FROM campana.miembros_visibles() v
      JOIN campana.miembros m  ON m.id = v.miembro_id
      JOIN personas.personas p ON p.id = m.persona_id
     WHERE m.cargo_codigo IN ('COORDINADOR', 'LIDER', 'SUBLIDER')
     ORDER BY m.cargo_codigo, 2;
$$;
REVOKE EXECUTE ON FUNCTION campana.miembros_para_filtro() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION campana.miembros_para_filtro() TO rol_app;

COMMIT;
