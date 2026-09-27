-- =============================================================================
--  26_alcance_red.sql
--  Corrige una fuga en el ranking, las metas por líder y la lista de líderes
--  inactivos: se consultaban sobre TODOS los miembros de la campaña.
--    - Un líder veía el nombre de todos los líderes del departamento.
--    - Un coordinador de Florencia veía a los de San Vicente, y como la
--      seguridad por fila le oculta sus simpatizantes, les contaba cero
--      registros y los mostraba como "inactivos" (alertas falsas).
--
--  campana.miembros_visibles(): la red propia del usuario más la de los
--  miembros con territorio dentro de su alcance. El gerente y el candidato
--  (todo el departamento) ven a todos; un coordinador, a su municipio; un
--  líder, a sí mismo y a sus sublíderes.
--
--  Requiere: 01 a 25. Se puede ejecutar más de una vez.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION campana.miembros_visibles()
RETURNS TABLE (miembro_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
    SELECT s.miembro_id
      FROM acceso.usuarios u
      JOIN campana.miembros m ON m.persona_id = u.persona_id
     CROSS JOIN LATERAL campana.subordinados(m.id) s
     WHERE u.id = acceso.usuario_actual()
    UNION
    SELECT s.miembro_id
      FROM campana.miembro_territorios mt
      JOIN acceso.territorios_visibles() tv ON tv.territorio_id = mt.territorio_id
     CROSS JOIN LATERAL campana.subordinados(mt.miembro_id) s;
$$;
REVOKE EXECUTE ON FUNCTION campana.miembros_visibles() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION campana.miembros_visibles() TO rol_app;

-- Los líderes para el registro asistido usan el mismo alcance (24 lo calculaba aparte).
CREATE OR REPLACE FUNCTION campana.lideres_para_registro()
RETURNS TABLE (miembro_id uuid, nombre text, cargo_codigo text, codigo_link text, municipio text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
    SELECT m.id, p.nombres || ' ' || p.apellidos, m.cargo_codigo, l.codigo,
           campana.municipio_de_miembro(m.id)
      FROM campana.miembros_visibles() v
      JOIN campana.miembros m        ON m.id = v.miembro_id AND m.activo
      JOIN personas.personas p       ON p.id = m.persona_id
      JOIN campana.links_referido l  ON l.miembro_id = m.id AND l.es_principal AND l.activo
                                    AND (l.expira_en IS NULL OR l.expira_en > now())
     WHERE m.cargo_codigo IN ('COORDINADOR', 'LIDER', 'SUBLIDER')
     ORDER BY 2;
$$;

COMMIT;
