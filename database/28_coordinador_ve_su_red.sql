-- =============================================================================
--  28_coordinador_ve_su_red.sql
--  Un municipio puede tener varios coordinadores, y cada coordinador ve SOLO
--  a sus líderes (los que están bajo él en la estructura) y a los votantes
--  que ellos refirieron. Antes, por tener el municipio asignado, un
--  coordinador veía a todos los líderes y simpatizantes del municipio,
--  incluidos los de otro coordinador.
--
--  - acceso.alcance_solo_red(): true para el coordinador (sin rol de
--    gerente, candidato ni superadministrador).
--  - Simpatizantes: al coordinador no le aplica la política por territorio;
--    los ve por su red (política p_simpatizantes_por_red, que ya existía).
--  - campana.miembros_visibles(): para el coordinador, su propia red, y
--    dentro de ella solo los miembros de su municipio.
--
--  El municipio del coordinador (27) sigue siendo obligatorio: define dónde
--  trabaja y qué necesidades, visitas y compromisos del territorio ve.
--
--  Requiere: 01 a 27. Se puede ejecutar más de una vez.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION acceso.alcance_solo_red() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
    SELECT EXISTS (SELECT 1 FROM acceso.usuario_roles
                    WHERE usuario_id = acceso.usuario_actual() AND rol_codigo = 'COORDINADOR')
       AND NOT EXISTS (SELECT 1 FROM acceso.usuario_roles
                        WHERE usuario_id = acceso.usuario_actual()
                          AND rol_codigo IN ('GERENTE', 'CANDIDATO', 'SUPERADMIN'));
$$;
REVOKE EXECUTE ON FUNCTION acceso.alcance_solo_red() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION acceso.alcance_solo_red() TO rol_app;

DROP POLICY IF EXISTS p_simpatizantes_por_territorio ON campana.simpatizantes;
CREATE POLICY p_simpatizantes_por_territorio ON campana.simpatizantes
    USING (NOT (SELECT acceso.alcance_solo_red())
           AND territorio_residencia_id IN (SELECT territorio_id FROM acceso.territorios_visibles()));

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
    ), solo_red AS (
        SELECT acceso.alcance_solo_red() AS si
    )
    -- Líder (sin territorio): su red completa.
    SELECT r.miembro_id FROM mi_red r
     WHERE NOT EXISTS (SELECT 1 FROM mis_territorios)
    UNION
    -- Coordinador: su red, solo los de su municipio (o sin municipio).
    SELECT r.miembro_id FROM mi_red r, solo_red
     WHERE solo_red.si
       AND coalesce(campana.municipio_id_de_miembro(r.miembro_id) IN (SELECT territorio_id FROM mis_territorios), true)
    UNION
    -- Gerente, candidato, digitador: por territorio (27).
    SELECT r.miembro_id FROM mi_red r, solo_red
     WHERE NOT solo_red.si AND campana.municipio_id_de_miembro(r.miembro_id) IS NULL
    UNION
    SELECT m.id FROM campana.miembros m, solo_red
     WHERE NOT solo_red.si
       AND campana.municipio_id_de_miembro(m.id) IN (SELECT territorio_id FROM mis_territorios)
    UNION
    SELECT mt.miembro_id FROM campana.miembro_territorios mt, solo_red
     WHERE NOT solo_red.si
       AND mt.territorio_id IN (SELECT territorio_id FROM mis_territorios);
$$;
REVOKE EXECUTE ON FUNCTION campana.miembros_visibles() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION campana.miembros_visibles() TO rol_app;

COMMIT;
