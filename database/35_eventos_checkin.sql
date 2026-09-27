-- ============================================================================
-- 35. Eventos: check-in por QR, asistencia manual y asistencia vs. referidos
-- ============================================================================
-- - Cada evento tiene un código (codigo_checkin) que va en el QR. Quien lo
--   escanea llega a /e/<código> y registra su asistencia. Si no está en la
--   base, queda registrado como simpatizante (canal EVENTO), acreditado al
--   miembro referente del evento (por defecto, quien lo creó).
-- - El equipo también puede marcar asistencia por cédula (método MANUAL).
-- - Comparativo por zona entre asistentes a eventos y referidos.
-- Requiere 33_enlace_lideres.sql. Se puede ejecutar más de una vez.
-- ============================================================================

-- Miembro al que se acreditan los asistentes nuevos del evento.
ALTER TABLE eventos.eventos
  ADD COLUMN IF NOT EXISTS miembro_referente_id uuid REFERENCES campana.miembros(id) ON DELETE SET NULL;

-- Rellena el referente de los eventos existentes con el miembro de quien lo creó.
UPDATE eventos.eventos e
   SET miembro_referente_id = m.id
  FROM acceso.usuarios u
  JOIN campana.miembros m ON m.persona_id = u.persona_id AND m.activo
 WHERE e.creado_por = u.id AND e.miembro_referente_id IS NULL;

CREATE OR REPLACE FUNCTION eventos.fn_referente_por_defecto() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
    IF NEW.miembro_referente_id IS NULL THEN
        SELECT m.id INTO NEW.miembro_referente_id
          FROM acceso.usuarios u
          JOIN campana.miembros m ON m.persona_id = u.persona_id AND m.activo
         WHERE u.id = NEW.creado_por
         LIMIT 1;
    END IF;
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_eventos_referente ON eventos.eventos;
CREATE TRIGGER trg_eventos_referente BEFORE INSERT ON eventos.eventos
FOR EACH ROW EXECUTE FUNCTION eventos.fn_referente_por_defecto();

-- ----------------------------------------------------------------------------
-- Datos públicos del evento para la página de check-in (sin datos personales).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION eventos.info_checkin(p_codigo text)
RETURNS TABLE (nombre text, tipo text, lugar text, municipio_id integer, inicia_en timestamptz, termina_en timestamptz,
               estado text, abierto boolean, abre_en timestamptz, cierra_en timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
    SELECT e.nombre, te.nombre, territorio.ruta(e.territorio_id), territorio.ancestro(e.territorio_id, 'MUNICIPIO'),
           e.inicia_en, e.termina_en, e.estado,
           e.estado <> 'CANCELADA'
             AND now() BETWEEN e.inicia_en - make_interval(mins => campana.parametro_int('CHECKIN_MARGEN_MINUTOS'))
                           AND e.termina_en + make_interval(mins => campana.parametro_int('CHECKIN_MARGEN_MINUTOS')),
           e.inicia_en - make_interval(mins => campana.parametro_int('CHECKIN_MARGEN_MINUTOS')),
           e.termina_en + make_interval(mins => campana.parametro_int('CHECKIN_MARGEN_MINUTOS'))
      FROM eventos.eventos e
      JOIN eventos.tipos_evento te ON te.codigo = e.tipo_codigo
     WHERE e.codigo_checkin = upper(btrim(p_codigo));
$$;
REVOKE EXECUTE ON FUNCTION eventos.info_checkin(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION eventos.info_checkin(text) TO rol_app;

-- ----------------------------------------------------------------------------
-- Check-in público por QR.
-- Siempre pide los datos completos (así la respuesta no revela si la cédula
-- ya estaba). Si la persona existe, solo marca la asistencia: no cambia sus
-- datos. Si no existe, la registra como simpatizante por el enlace del
-- referente del evento, y marca la asistencia.
-- Resultados: ASISTENCIA, REGISTRADO, YA_REGISTRADA, EVENTO_INVALIDO,
--             FUERA_DE_HORARIO, SIN_REFERENTE.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION eventos.checkin_publico(
    p_codigo_evento      text,
    p_tipo_documento     text,
    p_documento_hash     bytea,
    p_documento_cifrado  bytea,
    p_nombres            text,
    p_apellidos          text,
    p_telefono_hash      bytea,
    p_telefono_cifrado   bytea,
    p_territorio_id      integer,
    p_politica_version   smallint,
    p_finalidades        text[],
    p_ip                 inet,
    p_user_agent         text
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
    v_evento   eventos.eventos%ROWTYPE;
    v_margen   interval := make_interval(mins => campana.parametro_int('CHECKIN_MARGEN_MINUTOS'));
    v_persona  uuid;
    v_link     text;
    v_res      record;
    v_filas    integer;
    v_nuevo    boolean := false;
BEGIN
    SELECT * INTO v_evento FROM eventos.eventos WHERE codigo_checkin = upper(btrim(p_codigo_evento));
    IF NOT FOUND OR v_evento.estado = 'CANCELADA' THEN
        RETURN 'EVENTO_INVALIDO';
    END IF;
    IF now() NOT BETWEEN v_evento.inicia_en - v_margen AND v_evento.termina_en + v_margen THEN
        RETURN 'FUERA_DE_HORARIO';
    END IF;

    SELECT id INTO v_persona FROM personas.personas
     WHERE tipo_documento_codigo = p_tipo_documento AND documento_hash = p_documento_hash;

    IF v_persona IS NULL THEN
        -- Enlace de votantes del referente; si no tiene, el de su superior más cercano.
        WITH RECURSIVE cadena AS (
            SELECT m.id, m.superior_id, 0 AS paso FROM campana.miembros m WHERE m.id = v_evento.miembro_referente_id
            UNION ALL
            SELECT m.id, m.superior_id, c.paso + 1 FROM campana.miembros m JOIN cadena c ON m.id = c.superior_id WHERE c.paso < 10
        )
        SELECT l.codigo INTO v_link
          FROM cadena c
          JOIN campana.miembros m ON m.id = c.id AND m.activo
          JOIN campana.links_referido l ON l.miembro_id = c.id AND l.activo AND l.proposito = 'VOTANTE'
                                       AND (l.expira_en IS NULL OR l.expira_en > now())
         ORDER BY c.paso, l.es_principal DESC, l.creado_en
         LIMIT 1;
        IF v_link IS NULL THEN
            RETURN 'SIN_REFERENTE';
        END IF;

        SELECT * INTO v_res FROM campana.registrar_simpatizante(
            p_tipo_documento, p_documento_hash, p_documento_cifrado, p_nombres, p_apellidos,
            p_telefono_hash, p_telefono_cifrado, p_territorio_id, v_link, 'EVENTO',
            p_politica_version, p_finalidades,
            format('Aceptó la política v%s al registrar su asistencia al evento %s', p_politica_version, v_evento.codigo_checkin),
            now(), NULL, NULL, NULL, NULL, NULL, NULL, p_ip, p_user_agent);
        IF v_res.resultado <> 'REGISTRADO' THEN
            RAISE EXCEPTION 'No se pudo registrar a la persona: %', v_res.mensaje;
        END IF;
        v_persona := v_res.persona_id;
        v_nuevo := true;
    END IF;

    INSERT INTO eventos.asistencias (evento_id, persona_id, metodo)
    VALUES (v_evento.id, v_persona, 'QR')
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_filas = ROW_COUNT;

    IF v_nuevo THEN RETURN 'REGISTRADO'; END IF;
    RETURN CASE WHEN v_filas = 0 THEN 'YA_REGISTRADA' ELSE 'ASISTENCIA' END;
END $$;
REVOKE EXECUTE ON FUNCTION eventos.checkin_publico(text, text, bytea, bytea, text, text, bytea, bytea, integer, smallint, text[], inet, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION eventos.checkin_publico(text, text, bytea, bytea, text, text, bytea, bytea, integer, smallint, text[], inet, text) TO rol_app;

-- ----------------------------------------------------------------------------
-- Asistencia manual por cédula (equipo en el evento). Respeta RLS: solo marca
-- a personas que el usuario puede ver, en eventos que puede ver.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION eventos.marcar_asistencia(p_evento_id uuid, p_tipo_documento text, p_documento_hash bytea)
RETURNS TABLE (resultado text, nombre text)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE
    v_persona record;
BEGIN
    IF NOT acceso.tiene_permiso('AGENDA_GESTIONAR') THEN
        RAISE EXCEPTION 'Sin permiso para registrar asistencia' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM eventos.eventos e WHERE e.id = p_evento_id AND e.estado <> 'CANCELADA') THEN
        RETURN QUERY SELECT 'EVENTO_INVALIDO'::text, NULL::text;
        RETURN;
    END IF;
    SELECT p.id, p.nombres || ' ' || p.apellidos AS nombre INTO v_persona
      FROM personas.personas p
     WHERE p.tipo_documento_codigo = p_tipo_documento AND p.documento_hash = p_documento_hash;
    IF NOT FOUND THEN
        RETURN QUERY SELECT 'NO_ENCONTRADA'::text, NULL::text;
        RETURN;
    END IF;
    INSERT INTO eventos.asistencias (evento_id, persona_id, metodo)
    VALUES (p_evento_id, v_persona.id, 'MANUAL')
    ON CONFLICT DO NOTHING;
    RETURN QUERY SELECT CASE WHEN FOUND THEN 'ASISTENCIA' ELSE 'YA_REGISTRADA' END, v_persona.nombre;
END $$;
REVOKE EXECUTE ON FUNCTION eventos.marcar_asistencia(uuid, text, bytea) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION eventos.marcar_asistencia(uuid, text, bytea) TO rol_app;

-- Asistentes de un evento (con RLS: cada quien ve a las personas de su alcance).
-- "nuevo" = se registró como simpatizante en este evento.
CREATE OR REPLACE FUNCTION eventos.asistentes_evento(p_evento_id uuid)
RETURNS TABLE (persona_id uuid, nombre text, residencia text, metodo text, registrada_en timestamptz, nuevo boolean)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
    SELECT p.id, p.nombres || ' ' || p.apellidos, territorio.ruta(s.territorio_residencia_id), a.metodo, a.registrada_en,
           coalesce(s.canal_codigo = 'EVENTO' AND s.recibido_en BETWEEN a.registrada_en - interval '5 minutes' AND a.registrada_en, false)
      FROM eventos.asistencias a
      JOIN personas.personas p ON p.id = a.persona_id
      LEFT JOIN campana.simpatizantes s ON s.persona_id = p.id
     WHERE a.evento_id = p_evento_id
     ORDER BY a.registrada_en DESC;
$$;
GRANT EXECUTE ON FUNCTION eventos.asistentes_evento(uuid) TO rol_app;

-- ----------------------------------------------------------------------------
-- Comparativo por zona: asistencia a eventos frente a referidos.
-- Sin municipio: una fila por municipio. Con municipio: una fila por vereda,
-- barrio o comuna (la zona donde fue el evento o donde vive el referido).
-- Invoker: cada quien cuenta solo lo que puede ver.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION eventos.comparativo_zonas(p_desde date, p_hasta date, p_municipio_id integer DEFAULT NULL)
RETURNS TABLE (zona_id integer, zona text, eventos bigint, asistentes bigint, asistentes_nuevos bigint,
               referidos bigint, referidos_en_eventos bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
    WITH ev AS (
        SELECT e.id,
               CASE WHEN p_municipio_id IS NULL THEN territorio.ancestro(e.territorio_id, 'MUNICIPIO') ELSE e.territorio_id END AS zona_id
          FROM eventos.eventos e
         WHERE e.estado <> 'CANCELADA'
           AND (e.inicia_en AT TIME ZONE 'America/Bogota')::date BETWEEN p_desde AND p_hasta
           AND (p_municipio_id IS NULL OR territorio.ancestro(e.territorio_id, 'MUNICIPIO') = p_municipio_id)
    ), asis AS (
        SELECT ev.zona_id, a.persona_id,
               bool_or(s.canal_codigo = 'EVENTO' AND s.recibido_en BETWEEN a.registrada_en - interval '5 minutes' AND a.registrada_en) AS nuevo
          FROM ev
          JOIN eventos.asistencias a ON a.evento_id = ev.id
          LEFT JOIN campana.simpatizantes s ON s.persona_id = a.persona_id
         GROUP BY 1, 2
    ), refs AS (
        SELECT CASE WHEN p_municipio_id IS NULL THEN territorio.ancestro(s.territorio_residencia_id, 'MUNICIPIO')
                    ELSE s.territorio_residencia_id END AS zona_id,
               count(*) AS referidos,
               count(*) FILTER (WHERE s.canal_codigo = 'EVENTO') AS referidos_en_eventos
          FROM campana.simpatizantes s
         WHERE (s.capturado_en AT TIME ZONE 'America/Bogota')::date BETWEEN p_desde AND p_hasta
           AND s.estado_codigo <> 'RETIRADO'
           AND (p_municipio_id IS NULL OR territorio.ancestro(s.territorio_residencia_id, 'MUNICIPIO') = p_municipio_id)
         GROUP BY 1
    ), zonas AS (
        SELECT zona_id FROM ev UNION SELECT zona_id FROM refs
    )
    SELECT z.zona_id,
           CASE WHEN p_municipio_id IS NULL THEN t.nombre
                WHEN z.zona_id = p_municipio_id THEN t.nombre || ' (sin vereda o barrio)'
                ELSE t.nombre END,
           (SELECT count(*) FROM ev WHERE ev.zona_id = z.zona_id),
           (SELECT count(*) FROM asis WHERE asis.zona_id = z.zona_id),
           (SELECT count(*) FROM asis WHERE asis.zona_id = z.zona_id AND asis.nuevo),
           coalesce(r.referidos, 0),
           coalesce(r.referidos_en_eventos, 0)
      FROM zonas z
      JOIN territorio.territorios t ON t.id = z.zona_id
      LEFT JOIN refs r ON r.zona_id = z.zona_id
     ORDER BY 4 DESC, 6 DESC, 2;
$$;
GRANT EXECUTE ON FUNCTION eventos.comparativo_zonas(date, date, integer) TO rol_app;

-- ----------------------------------------------------------------------------
-- En un evento es normal que muchas personas se registren en pocos minutos:
-- los registros por check-in (canal EVENTO) no disparan la alerta de registro
-- masivo ni cuentan para ella. (Misma función de 31_calidad.sql.)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION calidad.fn_detectar_registro_masivo()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
    v_miembro  uuid;
    v_cantidad integer;
    v_minutos  integer := campana.parametro_int('REGISTRO_MASIVO_MINUTOS');
BEGIN
    IF NEW.canal_codigo = 'EVENTO' THEN
        RETURN NULL;
    END IF;
    -- Registros del mismo link capturados en la ventana que termina con este.
    SELECT count(*) INTO v_cantidad
      FROM campana.simpatizantes
     WHERE link_referido_id = NEW.link_referido_id
       AND canal_codigo <> 'EVENTO'
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
