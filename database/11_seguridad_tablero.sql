-- =============================================================================
--  11_seguridad_tablero.sql
--  Cierra dos fugas detectadas al probar el tablero con un líder:
--    1. Veía el total de alertas de calidad de toda la campaña.
--    2. Veía el tamaño de toda la estructura (miembros activos).
--  Requiere: 01 a 05 y 10. Se puede ejecutar más de una vez.
-- =============================================================================

-- 1. Alertas: solo las ve quien tiene el permiso ALERTA_GESTIONAR.
--    Los triggers que crean alertas son SECURITY DEFINER, así que siguen
--    funcionando para todos los registros.
ALTER TABLE calidad.alertas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_alertas_gestores ON calidad.alertas;
CREATE POLICY p_alertas_gestores ON calidad.alertas
    USING (acceso.tiene_permiso('ALERTA_GESTIONAR'));

ALTER TABLE calidad.alerta_personas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_alerta_personas ON calidad.alerta_personas;
CREATE POLICY p_alerta_personas ON calidad.alerta_personas
    USING (EXISTS (SELECT 1 FROM calidad.alertas a WHERE a.id = alerta_personas.alerta_id));

ALTER TABLE calidad.alerta_miembros ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_alerta_miembros ON calidad.alerta_miembros;
CREATE POLICY p_alerta_miembros ON calidad.alerta_miembros
    USING (EXISTS (SELECT 1 FROM calidad.alertas a WHERE a.id = alerta_miembros.alerta_id));

-- 2. Miembros activos del tablero: se cuentan dentro de la red del usuario
--    (él y sus subordinados). El gerente, que está en la raíz, ve todos.
CREATE OR REPLACE FUNCTION campana.mi_red() RETURNS TABLE (miembro_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
    SELECT s.miembro_id
      FROM acceso.usuarios u
      JOIN campana.miembros m ON m.persona_id = u.persona_id
     CROSS JOIN LATERAL campana.subordinados(m.id) s
     WHERE u.id = acceso.usuario_actual();
$$;

CREATE OR REPLACE VIEW campana.v_tablero WITH (security_invoker = true) AS
SELECT
    (SELECT count(*) FROM campana.simpatizantes WHERE estado_codigo = 'ACTIVO')                 AS simpatizantes_activos,
    (SELECT count(*) FROM campana.simpatizantes WHERE capturado_en::date = current_date)        AS registros_hoy,
    (SELECT count(*) FROM campana.simpatizantes WHERE capturado_en > now() - interval '7 days') AS registros_semana,
    (SELECT count(*) FROM campana.miembros m
      WHERE m.activo AND m.id IN (SELECT miembro_id FROM campana.mi_red()))                     AS miembros_activos,
    (SELECT count(*) FROM calidad.alertas WHERE estado IN ('ABIERTA','EN_REVISION'))            AS alertas_abiertas,
    (SELECT count(*) FROM participacion.necesidades)                                            AS necesidades_reportadas;
