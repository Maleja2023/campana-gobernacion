-- =============================================================================
--  25_registro_sin_conexion.sql
--  Soporte en la base para el registro sin conexión (veredas sin señal): el
--  registro se captura en el celular y se envía horas o días después.
--    1. La autorización de datos queda con la fecha y hora en que la persona
--       la dio (la de captura), no con la del envío.
--    2. El historial anota que el registro se capturó sin conexión y cuándo
--       se envió.
--  Requiere: 01 a 24. Se puede ejecutar más de una vez.
-- =============================================================================

BEGIN;

-- 1. Hora real de la autorización ---------------------------------------------
-- campana.registrar_simpatizante inserta la autorización (con otorgada_en =
-- now()) justo antes que el simpatizante (con capturado_en = hora del
-- dispositivo). Si la captura fue antes, se corrige la autorización recién
-- creada en esa misma transacción.
CREATE OR REPLACE FUNCTION campana.fn_autorizacion_hora_captura() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
    IF NEW.capturado_en < now() - interval '5 minutes' THEN
        UPDATE cumplimiento.autorizaciones
           SET otorgada_en = NEW.capturado_en
         WHERE persona_id = NEW.persona_id
           AND otorgada_en = now();
    END IF;
    RETURN NULL;
END $$;
REVOKE EXECUTE ON FUNCTION campana.fn_autorizacion_hora_captura() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_autorizacion_hora_captura ON campana.simpatizantes;
CREATE TRIGGER trg_autorizacion_hora_captura
AFTER INSERT ON campana.simpatizantes
FOR EACH ROW EXECUTE FUNCTION campana.fn_autorizacion_hora_captura();

-- 2. Historial: el registro dice si se capturó sin conexión --------------------
CREATE OR REPLACE FUNCTION campana.fn_historial_registro() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
    v_lider  text;
    v_puesto text;
BEGIN
    SELECT p.nombres || ' ' || p.apellidos INTO v_lider
      FROM campana.links_referido l
      JOIN campana.miembros m  ON m.id = l.miembro_id
      JOIN personas.personas p ON p.id = m.persona_id
     WHERE l.id = NEW.link_referido_id;
    SELECT pv.nombre INTO v_puesto
      FROM campana.simpatizante_puesto sp
      JOIN electoral.puestos_votacion pv ON pv.id = sp.puesto_id
     WHERE sp.persona_id = NEW.persona_id
     ORDER BY sp.registrado_en DESC
     LIMIT 1;
    PERFORM campana.anotar_historial(
        NEW.persona_id, 'REGISTRO',
        jsonb_strip_nulls(jsonb_build_object(
            'residencia', jsonb_build_object('despues', campana.nombre_territorio(NEW.territorio_residencia_id)),
            'lider',      jsonb_build_object('despues', v_lider),
            'canal',      jsonb_build_object('despues', NEW.canal_codigo),
            'puesto',     CASE WHEN v_puesto IS NOT NULL THEN jsonb_build_object('despues', v_puesto) END)),
        CASE WHEN NEW.capturado_en < NEW.recibido_en - interval '5 minutes'
             THEN 'Capturado sin conexión el ' || to_char(NEW.capturado_en AT TIME ZONE 'America/Bogota', 'DD/MM/YYYY HH24:MI')
                  || ' y enviado el ' || to_char(NEW.recibido_en AT TIME ZONE 'America/Bogota', 'DD/MM/YYYY HH24:MI') END);
    RETURN NULL;
END $$;

COMMIT;
