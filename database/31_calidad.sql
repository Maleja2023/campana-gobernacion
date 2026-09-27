-- =============================================================================
--  31_calidad.sql
--  Calidad de datos:
--    - Registro masivo: se mide por la hora de CAPTURA, no por la de llegada.
--      Antes, un líder que registraba sin conexión durante el día y enviaba
--      20 registros juntos al volver la señal disparaba una alerta falsa.
--    - Puntaje de calidad por líder (0 a 100), con su desglose:
--        Completitud (40 puntos): con teléfono (15), con puesto de votación
--        (15) y con vereda o barrio, no solo el municipio (10).
--        Confiabilidad (60 puntos): se descuenta por intentos de registrar
--        cédulas que ya tenía otro líder, por personas en alertas abiertas o
--        confirmadas (no las descartadas) y por registros retirados.
--      Solo devuelve cifras agregadas, y solo de los miembros que el
--      usuario puede ver.
--
--  Requiere: 01 a 30. Se puede ejecutar más de una vez.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION calidad.fn_detectar_registro_masivo()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
    v_miembro  uuid;
    v_cantidad integer;
    v_minutos  integer := campana.parametro_int('REGISTRO_MASIVO_MINUTOS');
BEGIN
    -- Registros del mismo link capturados en la ventana que termina con este.
    SELECT count(*) INTO v_cantidad
      FROM campana.simpatizantes
     WHERE link_referido_id = NEW.link_referido_id
       AND capturado_en BETWEEN NEW.capturado_en - make_interval(mins => v_minutos) AND NEW.capturado_en;
    IF v_cantidad >= campana.parametro_int('REGISTRO_MASIVO_UMBRAL') THEN
        SELECT miembro_id INTO v_miembro FROM campana.links_referido WHERE id = NEW.link_referido_id;
        -- Una sola alerta abierta por miembro y por hora
        IF NOT EXISTS (
            SELECT 1 FROM calidad.alertas a
              JOIN calidad.alerta_miembros am ON am.alerta_id = a.id
             WHERE a.tipo_codigo = 'REGISTRO_MASIVO' AND am.miembro_id = v_miembro
               AND a.estado IN ('ABIERTA','EN_REVISION') AND a.detectada_en > now() - interval '1 hour'
        ) THEN
            PERFORM calidad.crear_alerta('REGISTRO_MASIVO', '{}', ARRAY[v_miembro],
                    format('%s registros capturados en %s minutos (hasta el %s)', v_cantidad, v_minutos,
                           to_char(NEW.capturado_en AT TIME ZONE 'America/Bogota', 'DD/MM/YYYY HH24:MI')));
        END IF;
    END IF;
    RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION calidad.puntaje_lideres()
RETURNS TABLE (miembro_id uuid, nombre text, cargo_codigo text, municipio text, registros integer,
               con_telefono_pct numeric, con_puesto_pct numeric, con_zona_pct numeric,
               intentos_duplicado integer, personas_en_alertas integer, retirados integer,
               completitud numeric, confiabilidad numeric, puntaje integer, nivel text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
    WITH miembros AS (
        SELECT mb.id, p.nombres || ' ' || p.apellidos AS nombre, mb.cargo_codigo
          FROM campana.miembros_visibles() v
          JOIN campana.miembros mb ON mb.id = v.miembro_id AND mb.activo
          JOIN personas.personas p ON p.id = mb.persona_id
         WHERE mb.cargo_codigo IN ('LIDER', 'SUBLIDER')
    ), refs AS (
        SELECT l.miembro_id, s.persona_id, s.estado_codigo, t.tipo_codigo AS tipo_zona
          FROM campana.simpatizantes s
          JOIN campana.links_referido l ON l.id = s.link_referido_id
          JOIN territorio.territorios t ON t.id = s.territorio_residencia_id
         WHERE l.miembro_id IN (SELECT id FROM miembros)
    ), cifras AS (
        SELECT m.id, m.nombre, m.cargo_codigo,
               count(r.persona_id) FILTER (WHERE r.estado_codigo = 'ACTIVO') AS activos,
               count(r.persona_id) FILTER (WHERE r.estado_codigo = 'ACTIVO'
                   AND EXISTS (SELECT 1 FROM personas.telefonos tf WHERE tf.persona_id = r.persona_id)) AS con_tel,
               count(r.persona_id) FILTER (WHERE r.estado_codigo = 'ACTIVO'
                   AND EXISTS (SELECT 1 FROM campana.simpatizante_puesto sp WHERE sp.persona_id = r.persona_id)) AS con_puesto,
               count(r.persona_id) FILTER (WHERE r.estado_codigo = 'ACTIVO' AND r.tipo_zona <> 'MUNICIPIO') AS con_zona,
               count(r.persona_id) FILTER (WHERE r.estado_codigo <> 'ACTIVO') AS retirados,
               (SELECT count(*) FROM calidad.intentos_duplicado i JOIN campana.links_referido li ON li.id = i.link_referido_id
                 WHERE li.miembro_id = m.id) AS duplicados,
               (SELECT count(DISTINCT ap.persona_id) FROM calidad.alerta_personas ap
                  JOIN calidad.alertas a ON a.id = ap.alerta_id AND a.estado <> 'DESCARTADA'
                 WHERE ap.persona_id IN (SELECT persona_id FROM refs WHERE refs.miembro_id = m.id)) AS en_alertas
          FROM miembros m
          LEFT JOIN refs r ON r.miembro_id = m.id
         GROUP BY m.id, m.nombre, m.cargo_codigo
    ), calculo AS (
        SELECT c.*,
               CASE WHEN c.activos > 0 THEN 100.0 * c.con_tel / c.activos END AS tel_pct,
               CASE WHEN c.activos > 0 THEN 100.0 * c.con_puesto / c.activos END AS puesto_pct,
               CASE WHEN c.activos > 0 THEN 100.0 * c.con_zona / c.activos END AS zona_pct,
               -- Cada problema pesa sobre el total de registros del líder: 10 % de
               -- problemas deja la confiabilidad en la mitad; 20 % o más, en cero.
               greatest(0, 60 * (1 - 5.0 * (c.duplicados + 2 * c.en_alertas + c.retirados)
                                     / greatest(c.activos + c.retirados, 1))) AS confiab
          FROM cifras c
    )
    SELECT k.id, k.nombre, k.cargo_codigo, campana.municipio_de_miembro(k.id), (k.activos)::integer,
           round(k.tel_pct, 1), round(k.puesto_pct, 1), round(k.zona_pct, 1),
           k.duplicados::integer, k.en_alertas::integer, k.retirados::integer,
           round(coalesce(0.15 * k.tel_pct + 0.15 * k.puesto_pct + 0.10 * k.zona_pct, 0), 1),
           round(k.confiab, 1),
           CASE WHEN k.activos + k.retirados = 0 THEN NULL
                ELSE round(coalesce(0.15 * k.tel_pct + 0.15 * k.puesto_pct + 0.10 * k.zona_pct, 0) + k.confiab)::integer END,
           CASE WHEN k.activos + k.retirados = 0 THEN 'SIN_DATOS'
                WHEN coalesce(0.15 * k.tel_pct + 0.15 * k.puesto_pct + 0.10 * k.zona_pct, 0) + k.confiab >= 80 THEN 'ALTA'
                WHEN coalesce(0.15 * k.tel_pct + 0.15 * k.puesto_pct + 0.10 * k.zona_pct, 0) + k.confiab >= 60 THEN 'MEDIA'
                ELSE 'BAJA' END
      FROM calculo k;
$$;
REVOKE EXECUTE ON FUNCTION calidad.puntaje_lideres() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION calidad.puntaje_lideres() TO rol_app;

COMMIT;
