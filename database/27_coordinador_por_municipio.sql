-- =============================================================================
--  27_coordinador_por_municipio.sql
--  Un coordinador pertenece a UN municipio y solo ve a los líderes de ese
--  municipio: en el árbol de la red, el ranking, las metas, los líderes
--  inactivos y la lista de líderes del registro.
--
--  Antes, un coordinador veía toda su red aunque tuviera líderes asignados a
--  otro municipio. Ahora el municipio de cada miembro (el de su propio
--  territorio o, si no tiene, el de su superior más cercano con territorio)
--  decide quién lo ve.
--
--  campana.miembros_visibles():
--    - Usuario sin territorio (líder): su red, completa.
--    - Usuario con territorio (coordinador, digitador, gerente, candidato):
--        · los miembros cuyo municipio está en su territorio;
--        · los miembros con territorio asignado dentro de su territorio
--          (un digitador de una vereda ve a los líderes de esa vereda);
--        · de su propia red, solo los que no tienen municipio.
--    El gerente y el candidato tienen el departamento: ven a todos.
--
--  Requiere: 01 a 26. Se puede ejecutar más de una vez.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION campana.municipio_id_de_miembro(p_miembro_id uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
    WITH RECURSIVE arriba AS (
        SELECT m.id, m.superior_id, 0 AS nivel FROM campana.miembros m WHERE m.id = p_miembro_id
        UNION ALL
        SELECT s.id, s.superior_id, a.nivel + 1 FROM campana.miembros s JOIN arriba a ON s.id = a.superior_id
    )
    SELECT territorio.ancestro(mt.territorio_id, 'MUNICIPIO')
      FROM arriba a
      JOIN campana.miembro_territorios mt ON mt.miembro_id = a.id
     WHERE territorio.ancestro(mt.territorio_id, 'MUNICIPIO') IS NOT NULL
     ORDER BY a.nivel, mt.territorio_id
     LIMIT 1;
$$;
REVOKE EXECUTE ON FUNCTION campana.municipio_id_de_miembro(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION campana.municipio_id_de_miembro(uuid) TO rol_app;

CREATE OR REPLACE FUNCTION campana.miembros_visibles()
RETURNS TABLE (miembro_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
    WITH mis_territorios AS (
        SELECT territorio_id FROM acceso.territorios_visibles()
    ), mi_red AS (
        SELECT s.miembro_id
          FROM acceso.usuarios u
          JOIN campana.miembros m ON m.persona_id = u.persona_id
         CROSS JOIN LATERAL campana.subordinados(m.id) s
         WHERE u.id = acceso.usuario_actual()
    )
    -- Líder (sin territorio): su red completa.
    SELECT r.miembro_id FROM mi_red r
     WHERE NOT EXISTS (SELECT 1 FROM mis_territorios)
    UNION
    -- Con territorio: su propia red solo si el miembro no tiene municipio.
    SELECT r.miembro_id FROM mi_red r
     WHERE campana.municipio_id_de_miembro(r.miembro_id) IS NULL
    UNION
    -- Miembros cuyo municipio está en su territorio.
    SELECT m.id FROM campana.miembros m
     WHERE campana.municipio_id_de_miembro(m.id) IN (SELECT territorio_id FROM mis_territorios)
    UNION
    -- Miembros con un territorio propio dentro de su territorio.
    SELECT mt.miembro_id FROM campana.miembro_territorios mt
     WHERE mt.territorio_id IN (SELECT territorio_id FROM mis_territorios);
$$;
REVOKE EXECUTE ON FUNCTION campana.miembros_visibles() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION campana.miembros_visibles() TO rol_app;

COMMIT;
