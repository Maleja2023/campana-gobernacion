-- =============================================================================
--  30_tablero_reportes.sql
--  Tablero y reportes:
--    - Hora de Colombia en la base: "hoy", "esta semana" y los registros por
--      día se cuentan con la fecha de Bogotá (antes, UTC: un registro a las
--      8 p. m. contaba como del día siguiente).
--    - La meta de un miembro cuenta toda su red (él y los que están bajo él),
--      no solo sus referidos directos: la meta de un coordinador es la de su
--      equipo.
--    - Indicadores con crecimiento (hoy vs. ayer, semana vs. semana anterior)
--      y avance frente a la meta.
--    - Reportes por municipio y por líder (por puesto: campana.brecha_puestos, 29).
--    - Proyección de cumplimiento de metas según el ritmo de los últimos 14 días.
--    - Bitácora de exportaciones: qué se exportó (recurso) y consulta para
--      quien administra usuarios.
--
--  Todo es SECURITY INVOKER salvo la bitácora: cada usuario ve solo lo de su
--  alcance.
--
--  Requiere: 01 a 29. Se puede ejecutar más de una vez.
-- =============================================================================

BEGIN;

DO $$
BEGIN
    EXECUTE format('ALTER DATABASE %I SET timezone = %L', current_database(), 'America/Bogota');
END $$;
SET LOCAL timezone = 'America/Bogota';

-- Meta de un miembro: registros de toda su red en el periodo de la meta.
CREATE OR REPLACE VIEW campana.v_avance_metas_miembro WITH (security_invoker = true) AS
SELECT mm.miembro_id,
       mm.cantidad AS meta,
       mm.fecha_inicio,
       mm.fecha_limite,
       count(s.persona_id) AS registrados,
       round(100.0 * count(s.persona_id) / mm.cantidad, 1) AS porcentaje
  FROM campana.metas_miembro mm
  LEFT JOIN LATERAL campana.subordinados(mm.miembro_id) sub ON true
  LEFT JOIN campana.links_referido l ON l.miembro_id = sub.miembro_id
  LEFT JOIN campana.simpatizantes s
         ON s.link_referido_id = l.id AND s.estado_codigo = 'ACTIVO'
        AND s.capturado_en::date BETWEEN mm.fecha_inicio AND mm.fecha_limite
 GROUP BY mm.id, mm.miembro_id, mm.cantidad, mm.fecha_inicio, mm.fecha_limite;

-- ---------------------------------------------------------------------------
-- Indicadores del tablero
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION campana.indicadores_tablero()
RETURNS TABLE (simpatizantes_activos integer, registros_hoy integer, registros_ayer integer,
               registros_semana integer, registros_semana_anterior integer, registros_mes integer,
               meta integer, avance_pct numeric, miembros_activos integer, lideres_con_registros_semana integer,
               alertas_abiertas integer, necesidades_reportadas integer)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
    WITH s AS (
        SELECT capturado_en::date AS dia, link_referido_id FROM campana.simpatizantes WHERE estado_codigo = 'ACTIVO'
    ), mi_miembro AS (
        SELECT m.id FROM acceso.usuarios u JOIN campana.miembros m ON m.persona_id = u.persona_id
         WHERE u.id = acceso.usuario_actual()
    ), meta_territorial AS (
        -- La meta vigente (la de fecha límite más lejana) de cada territorio visible.
        SELECT DISTINCT ON (mt.territorio_id) mt.territorio_id, mt.cantidad, t.tipo_codigo
          FROM campana.metas_territorio mt
          JOIN territorio.territorios t ON t.id = mt.territorio_id
         WHERE mt.territorio_id IN (SELECT territorio_id FROM acceso.territorios_visibles())
         ORDER BY mt.territorio_id, mt.fecha_limite DESC
    ), meta AS (
        SELECT CASE
                 WHEN acceso.alcance_solo_red() OR NOT EXISTS (SELECT 1 FROM meta_territorial)
                   THEN (SELECT mm.cantidad FROM campana.metas_miembro mm JOIN mi_miembro ON mm.miembro_id = mi_miembro.id
                          ORDER BY mm.fecha_limite DESC LIMIT 1)
                 WHEN EXISTS (SELECT 1 FROM meta_territorial WHERE tipo_codigo = 'DEPARTAMENTO')
                   THEN (SELECT max(cantidad) FROM meta_territorial WHERE tipo_codigo = 'DEPARTAMENTO')
                 ELSE (SELECT sum(cantidad) FROM meta_territorial WHERE tipo_codigo = 'MUNICIPIO')
               END::integer AS cantidad
    )
    SELECT (SELECT count(*) FROM s)::integer,
           (SELECT count(*) FROM s WHERE dia = current_date)::integer,
           (SELECT count(*) FROM s WHERE dia = current_date - 1)::integer,
           (SELECT count(*) FROM s WHERE dia > current_date - 7)::integer,
           (SELECT count(*) FROM s WHERE dia <= current_date - 7 AND dia > current_date - 14)::integer,
           (SELECT count(*) FROM s WHERE dia > current_date - 30)::integer,
           meta.cantidad,
           CASE WHEN meta.cantidad > 0 THEN round(100.0 * (SELECT count(*) FROM s) / meta.cantidad, 1) END,
           (SELECT count(*) FROM campana.miembros m
             WHERE m.activo AND m.id IN (SELECT miembro_id FROM campana.miembros_visibles()))::integer,
           (SELECT count(DISTINCT l.miembro_id) FROM s JOIN campana.links_referido l ON l.id = s.link_referido_id
             WHERE s.dia > current_date - 7
               AND l.miembro_id IN (SELECT miembro_id FROM campana.miembros_visibles()))::integer,
           (SELECT count(*) FROM calidad.alertas WHERE estado IN ('ABIERTA', 'EN_REVISION'))::integer,
           (SELECT count(*) FROM participacion.necesidades)::integer
      FROM meta;
$$;
GRANT EXECUTE ON FUNCTION campana.indicadores_tablero() TO rol_app;

-- ---------------------------------------------------------------------------
-- Reporte por municipio
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION campana.reporte_municipios(p_desde date, p_hasta date)
RETURNS TABLE (municipio_id integer, municipio text, simpatizantes integer, en_rango integer,
               ultimos_7_dias integer, meta integer, avance_pct numeric, lideres integer,
               lideres_activos_semana integer, necesidades integer, puestos integer,
               potencial_electoral integer, cobertura_pct numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
    WITH municipios AS (
        SELECT t.id, t.nombre FROM territorio.territorios t
         WHERE t.tipo_codigo = 'MUNICIPIO' AND t.id IN (SELECT territorio_id FROM acceso.territorios_visibles())
    ), contenido AS (
        SELECT m.id AS municipio_id, d.territorio_id
          FROM municipios m CROSS JOIN LATERAL territorio.descendientes(m.id) d
    ), s AS (
        SELECT c.municipio_id, x.capturado_en::date AS dia, x.link_referido_id
          FROM campana.simpatizantes x JOIN contenido c ON c.territorio_id = x.territorio_residencia_id
         WHERE x.estado_codigo = 'ACTIVO'
    ), lideres AS (
        SELECT campana.municipio_id_de_miembro(v.miembro_id) AS municipio_id, v.miembro_id
          FROM campana.miembros_visibles() v JOIN campana.miembros mb ON mb.id = v.miembro_id
         WHERE mb.activo AND mb.cargo_codigo IN ('LIDER', 'SUBLIDER')
    ), jornada AS (SELECT id FROM electoral.jornadas ORDER BY fecha DESC, id DESC LIMIT 1)
    SELECT m.id, m.nombre,
           (SELECT count(*) FROM s WHERE s.municipio_id = m.id)::integer,
           (SELECT count(*) FROM s WHERE s.municipio_id = m.id
               AND (p_desde IS NULL OR s.dia >= p_desde) AND (p_hasta IS NULL OR s.dia <= p_hasta))::integer,
           (SELECT count(*) FROM s WHERE s.municipio_id = m.id AND s.dia > current_date - 7)::integer,
           mt.cantidad,
           CASE WHEN mt.cantidad > 0 THEN round(100.0 * (SELECT count(*) FROM s WHERE s.municipio_id = m.id) / mt.cantidad, 1) END,
           (SELECT count(*) FROM lideres WHERE lideres.municipio_id = m.id)::integer,
           -- Líderes del municipio que registraron a alguien (donde sea) en los últimos 7 días.
           (SELECT count(*) FROM lideres ld
             WHERE ld.municipio_id = m.id
               AND EXISTS (SELECT 1 FROM campana.links_referido l
                             JOIN campana.simpatizantes x ON x.link_referido_id = l.id
                            WHERE l.miembro_id = ld.miembro_id AND x.capturado_en::date > current_date - 7))::integer,
           (SELECT count(*) FROM participacion.necesidades n JOIN contenido c ON c.territorio_id = n.territorio_id
             WHERE c.municipio_id = m.id)::integer,
           (SELECT count(*) FROM electoral.puestos_votacion pv JOIN electoral.puestos_jornada pj ON pj.puesto_id = pv.id
             JOIN jornada j ON j.id = pj.jornada_id WHERE territorio.ancestro(pv.territorio_id, 'MUNICIPIO') = m.id)::integer,
           pot.potencial,
           CASE WHEN pot.potencial > 0 THEN round(100.0 * (SELECT count(*) FROM s WHERE s.municipio_id = m.id) / pot.potencial, 1) END
      FROM municipios m
      LEFT JOIN LATERAL (SELECT mt.cantidad FROM campana.metas_territorio mt WHERE mt.territorio_id = m.id
                          ORDER BY mt.fecha_limite DESC LIMIT 1) mt ON true
      LEFT JOIN LATERAL (SELECT sum(pj.potencial_electoral)::integer AS potencial
                           FROM electoral.puestos_votacion pv
                           JOIN electoral.puestos_jornada pj ON pj.puesto_id = pv.id
                           JOIN jornada j ON j.id = pj.jornada_id
                          WHERE territorio.ancestro(pv.territorio_id, 'MUNICIPIO') = m.id) pot ON true;
$$;
GRANT EXECUTE ON FUNCTION campana.reporte_municipios(date, date) TO rol_app;

-- ---------------------------------------------------------------------------
-- Reporte por líder (coordinadores, líderes y sublíderes visibles)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION campana.reporte_lideres(p_municipio_id integer, p_desde date, p_hasta date)
RETURNS TABLE (miembro_id uuid, nombre text, cargo_codigo text, superior text, municipio text,
               activo boolean, propios integer, red integer, en_rango integer, ultimos_7_dias integer,
               ultimos_30_dias integer, ultimo_registro timestamptz, meta integer, avance_pct numeric,
               intentos_duplicado integer, alertas_abiertas integer)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
    WITH miembros AS (
        SELECT mb.id, mb.cargo_codigo, mb.superior_id, mb.activo, p.nombres || ' ' || p.apellidos AS nombre,
               campana.municipio_id_de_miembro(mb.id) AS municipio_id
          FROM campana.miembros_visibles() v
          JOIN campana.miembros mb ON mb.id = v.miembro_id
          JOIN personas.personas p ON p.id = mb.persona_id
         WHERE mb.cargo_codigo IN ('COORDINADOR', 'LIDER', 'SUBLIDER')
    ), s AS (
        SELECT l.miembro_id, x.capturado_en, x.capturado_en::date AS dia
          FROM campana.simpatizantes x JOIN campana.links_referido l ON l.id = x.link_referido_id
         WHERE x.estado_codigo = 'ACTIVO'
    )
    SELECT m.id, m.nombre, m.cargo_codigo, sp.nombres || ' ' || sp.apellidos, t.nombre, m.activo,
           (SELECT count(*) FROM s WHERE s.miembro_id = m.id)::integer,
           (SELECT count(*) FROM s WHERE s.miembro_id IN (SELECT miembro_id FROM campana.subordinados(m.id)))::integer,
           (SELECT count(*) FROM s WHERE s.miembro_id IN (SELECT miembro_id FROM campana.subordinados(m.id))
               AND (p_desde IS NULL OR s.dia >= p_desde) AND (p_hasta IS NULL OR s.dia <= p_hasta))::integer,
           (SELECT count(*) FROM s WHERE s.miembro_id IN (SELECT miembro_id FROM campana.subordinados(m.id))
               AND s.dia > current_date - 7)::integer,
           (SELECT count(*) FROM s WHERE s.miembro_id IN (SELECT miembro_id FROM campana.subordinados(m.id))
               AND s.dia > current_date - 30)::integer,
           (SELECT max(capturado_en) FROM s WHERE s.miembro_id = m.id),
           a.meta, a.porcentaje,
           (SELECT count(*) FROM calidad.intentos_duplicado i JOIN campana.links_referido li ON li.id = i.link_referido_id
             WHERE li.miembro_id = m.id)::integer,
           (SELECT count(*) FROM calidad.alerta_miembros am JOIN calidad.alertas al ON al.id = am.alerta_id
             WHERE am.miembro_id = m.id AND al.estado IN ('ABIERTA', 'EN_REVISION'))::integer
      FROM miembros m
      LEFT JOIN campana.miembros sup ON sup.id = m.superior_id
      LEFT JOIN personas.personas sp ON sp.id = sup.persona_id
      LEFT JOIN territorio.territorios t ON t.id = m.municipio_id
      LEFT JOIN LATERAL (SELECT va.meta, va.porcentaje FROM campana.v_avance_metas_miembro va
                          WHERE va.miembro_id = m.id ORDER BY va.fecha_limite DESC LIMIT 1) a ON true
     WHERE p_municipio_id IS NULL OR m.municipio_id = p_municipio_id;
$$;
GRANT EXECUTE ON FUNCTION campana.reporte_lideres(integer, date, date) TO rol_app;

-- ---------------------------------------------------------------------------
-- Proyección de cumplimiento de metas
--   ritmo_diario: promedio de registros por día de los últimos 14 días (o
--   desde el inicio de la meta, si empezó hace menos).
--   proyectado: registrados + ritmo_diario * días que faltan.
--   estado: CUMPLIDA, EN_CAMINO (proyectado >= meta), EN_RIESGO (>= 80 %),
--           NO_ALCANZA (< 80 %) o VENCIDA (pasó la fecha sin cumplir).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION campana.proyeccion_metas()
RETURNS TABLE (tipo text, referencia text, nombre text, meta integer, registrados integer,
               fecha_inicio date, fecha_limite date, dias_restantes integer, ritmo_diario numeric,
               ritmo_necesario numeric, proyectado integer, proyectado_pct numeric, fecha_estimada date, estado text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
    WITH base AS (
        SELECT 'MIEMBRO'::text AS tipo, mm.miembro_id::text AS referencia,
               p.nombres || ' ' || p.apellidos AS nombre, mm.cantidad AS meta,
               mm.fecha_inicio, mm.fecha_limite,
               (SELECT count(*) FROM campana.subordinados(mm.miembro_id) sub
                  JOIN campana.links_referido l ON l.miembro_id = sub.miembro_id
                  JOIN campana.simpatizantes s ON s.link_referido_id = l.id AND s.estado_codigo = 'ACTIVO'
                 WHERE s.capturado_en::date BETWEEN mm.fecha_inicio AND least(mm.fecha_limite, current_date)) AS registrados,
               (SELECT count(*) FROM campana.subordinados(mm.miembro_id) sub
                  JOIN campana.links_referido l ON l.miembro_id = sub.miembro_id
                  JOIN campana.simpatizantes s ON s.link_referido_id = l.id AND s.estado_codigo = 'ACTIVO'
                 WHERE s.capturado_en::date BETWEEN greatest(mm.fecha_inicio, current_date - 13) AND current_date) AS recientes
          FROM campana.metas_miembro mm
          JOIN campana.miembros mb ON mb.id = mm.miembro_id
          JOIN personas.personas p ON p.id = mb.persona_id
         WHERE mm.miembro_id IN (SELECT miembro_id FROM campana.miembros_visibles())
        UNION ALL
        SELECT 'TERRITORIO', mt.territorio_id::text, t.nombre, mt.cantidad, mt.fecha_inicio, mt.fecha_limite,
               (SELECT count(*) FROM campana.simpatizantes s
                 WHERE s.estado_codigo = 'ACTIVO'
                   AND s.territorio_residencia_id IN (SELECT territorio_id FROM territorio.descendientes(mt.territorio_id))),
               (SELECT count(*) FROM campana.simpatizantes s
                 WHERE s.estado_codigo = 'ACTIVO'
                   AND s.territorio_residencia_id IN (SELECT territorio_id FROM territorio.descendientes(mt.territorio_id))
                   AND s.capturado_en::date BETWEEN greatest(mt.fecha_inicio, current_date - 13) AND current_date)
          FROM campana.metas_territorio mt
          JOIN territorio.territorios t ON t.id = mt.territorio_id
         WHERE mt.territorio_id IN (SELECT territorio_id FROM acceso.territorios_visibles())
    ), calculo AS (
        SELECT b.*,
               (b.fecha_limite - current_date) AS dias_restantes,
               round(b.recientes::numeric / greatest(1, least(14, current_date - b.fecha_inicio + 1)), 2) AS ritmo
          FROM base b
    )
    SELECT c.tipo, c.referencia, c.nombre, c.meta, c.registrados::integer, c.fecha_inicio, c.fecha_limite,
           c.dias_restantes,
           c.ritmo,
           CASE WHEN c.dias_restantes > 0 AND c.registrados < c.meta
                THEN round((c.meta - c.registrados)::numeric / c.dias_restantes, 2) END,
           (c.registrados + c.ritmo * greatest(c.dias_restantes, 0))::integer,
           round(100.0 * (c.registrados + c.ritmo * greatest(c.dias_restantes, 0)) / c.meta, 1),
           CASE WHEN c.registrados >= c.meta THEN NULL
                WHEN c.ritmo > 0 THEN current_date + ceil((c.meta - c.registrados) / c.ritmo)::integer END,
           CASE WHEN c.registrados >= c.meta THEN 'CUMPLIDA'
                WHEN c.dias_restantes < 0 THEN 'VENCIDA'
                WHEN c.registrados + c.ritmo * c.dias_restantes >= c.meta THEN 'EN_CAMINO'
                WHEN c.registrados + c.ritmo * c.dias_restantes >= 0.8 * c.meta THEN 'EN_RIESGO'
                ELSE 'NO_ALCANZA' END
      FROM calculo c;
$$;
GRANT EXECUTE ON FUNCTION campana.proyeccion_metas() TO rol_app;

-- ---------------------------------------------------------------------------
-- Bitácora de exportaciones
-- ---------------------------------------------------------------------------
ALTER TABLE auditoria.exportaciones ADD COLUMN IF NOT EXISTS recurso text NOT NULL DEFAULT 'SIMPATIZANTES';

CREATE OR REPLACE FUNCTION auditoria.registrar_exportacion(p_motivo text, p_formato text, p_cantidad integer,
                                                          p_territorios integer[], p_recurso text)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
    v_id bigint;
BEGIN
    IF acceso.usuario_actual() IS NULL THEN
        RAISE EXCEPTION 'No hay usuario en la sesión (app.usuario_id)';
    END IF;
    INSERT INTO auditoria.exportaciones (usuario_id, motivo, formato, cantidad_registros, recurso)
    VALUES (acceso.usuario_actual(), p_motivo, p_formato, p_cantidad, coalesce(p_recurso, 'SIMPATIZANTES'))
    RETURNING id INTO v_id;

    INSERT INTO auditoria.exportacion_territorios (exportacion_id, territorio_id)
    SELECT DISTINCT v_id, t FROM unnest(p_territorios) t WHERE t IS NOT NULL;

    INSERT INTO auditoria.eventos (usuario_id, accion, esquema, tabla, registro_id, ip)
    VALUES (acceso.usuario_actual(), 'EXPORTACION', 'auditoria', 'exportaciones', v_id::text, inet_client_addr());
    RETURN v_id;
END $$;
REVOKE EXECUTE ON FUNCTION auditoria.registrar_exportacion(text, text, integer, integer[], text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION auditoria.registrar_exportacion(text, text, integer, integer[], text) TO rol_app;

-- Solo quien administra usuarios (gerente, superadministrador) lee la bitácora.
CREATE OR REPLACE FUNCTION auditoria.bitacora_exportaciones(p_limite integer)
RETURNS TABLE (id bigint, exportado_en timestamptz, usuario text, recurso text, motivo text,
               formato text, cantidad_registros integer, territorios text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
    IF NOT acceso.tiene_permiso('USUARIO_GESTIONAR') THEN
        RAISE EXCEPTION 'Sin permiso para ver la bitácora de exportaciones' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
        SELECT e.id, e.exportado_en, u.login::text, e.recurso::text, e.motivo::text, e.formato::text, e.cantidad_registros::integer,
               (SELECT string_agg(t.nombre, ', ' ORDER BY t.nombre)::text
                  FROM auditoria.exportacion_territorios et JOIN territorio.territorios t ON t.id = et.territorio_id
                 WHERE et.exportacion_id = e.id)
          FROM auditoria.exportaciones e
          JOIN acceso.usuarios u ON u.id = e.usuario_id
         ORDER BY e.exportado_en DESC
         LIMIT least(greatest(p_limite, 1), 500);
END $$;
REVOKE EXECUTE ON FUNCTION auditoria.bitacora_exportaciones(integer) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION auditoria.bitacora_exportaciones(integer) TO rol_app;

COMMIT;
