-- =============================================================================
--  24_historial_y_registro.sql
--  Completa el registro de votantes (fase 1):
--    1. Historial de cambios de cada simpatizante: quién, cuándo, qué campo y
--       de qué valor a qué valor (registro, edición, cambio de puesto,
--       retiro con su motivo y reactivación). La bitácora de auditoría solo
--       guarda el NOMBRE de los campos cambiados; esto es lo que el equipo
--       necesita ver en pantalla.
--    2. Líderes que un usuario puede elegir como "líder que refiere" al
--       registrar a alguien (el digitador no tiene red propia: elige entre
--       los líderes de su territorio).
--
--  Requiere: 01 a 21. Se puede ejecutar más de una vez.
-- =============================================================================

BEGIN;

-- 1. Historial -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS campana.historial_simpatizante (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    persona_id   uuid NOT NULL REFERENCES personas.personas(id) ON DELETE CASCADE,
    accion       text NOT NULL CHECK (accion IN ('REGISTRO', 'EDICION', 'RETIRO', 'REACTIVACION')),
    -- {"campo": {"antes": ..., "despues": ...}}. El teléfono nunca se guarda:
    -- solo se anota que cambió (el número vive cifrado en personas.telefonos).
    cambios      jsonb NOT NULL DEFAULT '{}'::jsonb,
    detalle      text,
    usuario_id   uuid REFERENCES acceso.usuarios(id) ON DELETE SET NULL,
    ocurrido_en  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_historial_simpatizante ON campana.historial_simpatizante (persona_id, ocurrido_en);

COMMENT ON TABLE campana.historial_simpatizante IS
    'Historial legible de cambios por simpatizante. Solo lo escriben los triggers; nadie lo edita ni lo borra.';

-- Inmutable: igual que la bitácora de auditoría.
DROP TRIGGER IF EXISTS trg_historial_inmutable ON campana.historial_simpatizante;
CREATE TRIGGER trg_historial_inmutable
BEFORE UPDATE OR DELETE ON campana.historial_simpatizante
FOR EACH ROW EXECUTE FUNCTION auditoria.fn_solo_insercion();

-- Solo se ve el historial de personas que el usuario puede ver como
-- simpatizantes (mismo alcance territorial y de red de siempre).
ALTER TABLE campana.historial_simpatizante ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_historial_lectura ON campana.historial_simpatizante;
CREATE POLICY p_historial_lectura ON campana.historial_simpatizante FOR SELECT
    USING (EXISTS (SELECT 1 FROM campana.simpatizantes s WHERE s.persona_id = historial_simpatizante.persona_id));
GRANT SELECT ON campana.historial_simpatizante TO rol_app;

-- Escribe una entrada. SECURITY DEFINER: los triggers corren con los permisos
-- de quien hizo el cambio, y ese usuario no tiene INSERT sobre el historial.
CREATE OR REPLACE FUNCTION campana.anotar_historial(
    p_persona_id uuid, p_accion text, p_cambios jsonb, p_detalle text DEFAULT NULL
) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
    INSERT INTO campana.historial_simpatizante (persona_id, accion, cambios, detalle, usuario_id)
    VALUES (p_persona_id, p_accion, coalesce(p_cambios, '{}'::jsonb), p_detalle, acceso.usuario_actual());
$$;
REVOKE EXECUTE ON FUNCTION campana.anotar_historial(uuid, text, jsonb, text) FROM PUBLIC;

-- Nombre legible de un territorio (para guardar "Macagual" y no un id).
CREATE OR REPLACE FUNCTION campana.nombre_territorio(p_id integer) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
    SELECT t.nombre || coalesce(' (' || m.nombre || ')', '')
      FROM territorio.territorios t
      LEFT JOIN territorio.territorios m
        ON m.id = territorio.ancestro(t.id, 'MUNICIPIO') AND m.id <> t.id
     WHERE t.id = p_id;
$$;
REVOKE EXECUTE ON FUNCTION campana.nombre_territorio(integer) FROM PUBLIC;

-- Registro, cambio de residencia, retiro y reactivación.
CREATE OR REPLACE FUNCTION campana.fn_historial_simpatizantes() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
    v_cambios jsonb := '{}'::jsonb;
BEGIN
    IF NEW.estado_codigo IS DISTINCT FROM OLD.estado_codigo THEN
        IF NEW.estado_codigo = 'RETIRADO' THEN
            PERFORM campana.anotar_historial(NEW.persona_id, 'RETIRO',
                jsonb_build_object('estado', jsonb_build_object('antes', OLD.estado_codigo, 'despues', NEW.estado_codigo)),
                NEW.motivo_retiro);
        ELSIF OLD.estado_codigo = 'RETIRADO' THEN
            PERFORM campana.anotar_historial(NEW.persona_id, 'REACTIVACION',
                jsonb_build_object('estado', jsonb_build_object('antes', OLD.estado_codigo, 'despues', NEW.estado_codigo)),
                OLD.motivo_retiro);
        ELSE
            v_cambios := v_cambios || jsonb_build_object('estado',
                jsonb_build_object('antes', OLD.estado_codigo, 'despues', NEW.estado_codigo));
        END IF;
    END IF;

    IF NEW.territorio_residencia_id IS DISTINCT FROM OLD.territorio_residencia_id THEN
        v_cambios := v_cambios || jsonb_build_object('residencia', jsonb_build_object(
            'antes',   campana.nombre_territorio(OLD.territorio_residencia_id),
            'despues', campana.nombre_territorio(NEW.territorio_residencia_id)));
    END IF;

    IF v_cambios <> '{}'::jsonb THEN
        PERFORM campana.anotar_historial(NEW.persona_id, 'EDICION', v_cambios, NULL);
    END IF;
    RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_historial_simpatizantes ON campana.simpatizantes;
CREATE TRIGGER trg_historial_simpatizantes
AFTER UPDATE OF estado_codigo, territorio_residencia_id ON campana.simpatizantes
FOR EACH ROW EXECUTE FUNCTION campana.fn_historial_simpatizantes();

-- El registro se anota al CONFIRMAR la transacción (trigger diferido): así
-- ya existen el teléfono y el puesto de votación que llegan en el mismo
-- registro, y todo queda en una sola entrada.
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
        NULL);
    RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_historial_registro ON campana.simpatizantes;
CREATE CONSTRAINT TRIGGER trg_historial_registro
AFTER INSERT ON campana.simpatizantes
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION campana.fn_historial_registro();

-- true si la persona se registró en esta misma transacción (now() es la hora
-- de inicio de la transacción y recibido_en toma ese mismo valor por defecto).
CREATE OR REPLACE FUNCTION campana.registrado_en_esta_transaccion(p_persona_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
    SELECT EXISTS (SELECT 1 FROM campana.simpatizantes s
                    WHERE s.persona_id = p_persona_id AND s.recibido_en = now());
$$;
REVOKE EXECUTE ON FUNCTION campana.registrado_en_esta_transaccion(uuid) FROM PUBLIC;

-- Nombres y apellidos (solo de personas que son simpatizantes).
CREATE OR REPLACE FUNCTION campana.fn_historial_personas() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
    v_cambios jsonb := '{}'::jsonb;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM campana.simpatizantes s WHERE s.persona_id = NEW.id) THEN
        RETURN NULL;
    END IF;
    IF NEW.nombres IS DISTINCT FROM OLD.nombres THEN
        v_cambios := v_cambios || jsonb_build_object('nombres', jsonb_build_object('antes', OLD.nombres, 'despues', NEW.nombres));
    END IF;
    IF NEW.apellidos IS DISTINCT FROM OLD.apellidos THEN
        v_cambios := v_cambios || jsonb_build_object('apellidos', jsonb_build_object('antes', OLD.apellidos, 'despues', NEW.apellidos));
    END IF;
    IF v_cambios <> '{}'::jsonb THEN
        PERFORM campana.anotar_historial(NEW.id, 'EDICION', v_cambios, NULL);
    END IF;
    RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_historial_personas ON personas.personas;
CREATE TRIGGER trg_historial_personas
AFTER UPDATE OF nombres, apellidos ON personas.personas
FOR EACH ROW EXECUTE FUNCTION campana.fn_historial_personas();

-- Teléfono: solo se anota que cambió el principal, nunca el número.
CREATE OR REPLACE FUNCTION campana.fn_historial_telefonos() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
    IF NOT NEW.es_principal THEN
        RETURN NULL;
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.es_principal AND OLD.telefono_hash = NEW.telefono_hash THEN
        RETURN NULL;
    END IF;
    -- Solo personas que ya eran simpatizantes: el teléfono del registro
    -- inicial queda cubierto por la entrada REGISTRO.
    IF NOT EXISTS (SELECT 1 FROM campana.simpatizantes s WHERE s.persona_id = NEW.persona_id)
       OR campana.registrado_en_esta_transaccion(NEW.persona_id) THEN
        RETURN NULL;
    END IF;
    PERFORM campana.anotar_historial(NEW.persona_id, 'EDICION',
        jsonb_build_object('telefono', jsonb_build_object('antes', '(oculto)', 'despues', '(actualizado)')), NULL);
    RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_historial_telefonos ON personas.telefonos;
CREATE TRIGGER trg_historial_telefonos
AFTER INSERT OR UPDATE OF es_principal, telefono_hash ON personas.telefonos
FOR EACH ROW EXECUTE FUNCTION campana.fn_historial_telefonos();

-- Puesto de votación.
CREATE OR REPLACE FUNCTION campana.fn_historial_puesto() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
    v_antes   text;
    v_despues text;
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.puesto_id = OLD.puesto_id THEN
        RETURN NULL;
    END IF;
    SELECT nombre INTO v_despues FROM electoral.puestos_votacion WHERE id = NEW.puesto_id;
    IF TG_OP = 'UPDATE' THEN
        SELECT nombre INTO v_antes FROM electoral.puestos_votacion WHERE id = OLD.puesto_id;
    ELSIF campana.registrado_en_esta_transaccion(NEW.persona_id) THEN
        -- Puesto declarado en el mismo registro: va dentro de la entrada REGISTRO.
        RETURN NULL;
    END IF;
    PERFORM campana.anotar_historial(NEW.persona_id, 'EDICION',
        jsonb_build_object('puesto', jsonb_build_object('antes', v_antes, 'despues', v_despues)), NULL);
    RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_historial_puesto ON campana.simpatizante_puesto;
CREATE TRIGGER trg_historial_puesto
AFTER INSERT OR UPDATE OF puesto_id ON campana.simpatizante_puesto
FOR EACH ROW EXECUTE FUNCTION campana.fn_historial_puesto();

-- Los simpatizantes registrados antes de este script reciben su entrada de
-- registro con la fecha real en que llegaron (solo una vez).
INSERT INTO campana.historial_simpatizante (persona_id, accion, cambios, detalle, usuario_id, ocurrido_en)
SELECT s.persona_id, 'REGISTRO',
       jsonb_build_object(
           'residencia', jsonb_build_object('despues', campana.nombre_territorio(s.territorio_residencia_id)),
           'lider',      jsonb_build_object('despues', p.nombres || ' ' || p.apellidos),
           'canal',      jsonb_build_object('despues', s.canal_codigo)),
       'Registro anterior al historial', s.registrado_por, s.recibido_en
  FROM campana.simpatizantes s
  JOIN campana.links_referido l ON l.id = s.link_referido_id
  JOIN campana.miembros m       ON m.id = l.miembro_id
  JOIN personas.personas p      ON p.id = m.persona_id
 WHERE NOT EXISTS (SELECT 1 FROM campana.historial_simpatizante h
                    WHERE h.persona_id = s.persona_id AND h.accion = 'REGISTRO');

-- 2. Líderes que se pueden elegir al registrar ---------------------------------
-- Los de la red propia del usuario (si es miembro de la estructura) y los que
-- dependen de un miembro con territorio dentro del alcance del usuario (así un
-- digitador de Florencia ve a los líderes de Florencia y no a los de San
-- Vicente). Solo miembros activos con un enlace principal activo.
-- Municipio de un miembro: el territorio asignado a él o, si no tiene, al
-- superior más cercano que tenga uno (un líder hereda el de su coordinador).
CREATE OR REPLACE FUNCTION campana.municipio_de_miembro(p_miembro_id uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
    WITH RECURSIVE arriba AS (
        SELECT m.id, m.superior_id, 0 AS nivel FROM campana.miembros m WHERE m.id = p_miembro_id
        UNION ALL
        SELECT s.id, s.superior_id, a.nivel + 1 FROM campana.miembros s JOIN arriba a ON s.id = a.superior_id
    )
    SELECT t.nombre
      FROM arriba a
      JOIN campana.miembro_territorios mt ON mt.miembro_id = a.id
      JOIN territorio.territorios t ON t.id = territorio.ancestro(mt.territorio_id, 'MUNICIPIO')
     ORDER BY a.nivel
     LIMIT 1;
$$;
REVOKE EXECUTE ON FUNCTION campana.municipio_de_miembro(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION campana.lideres_para_registro()
RETURNS TABLE (miembro_id uuid, nombre text, cargo_codigo text, codigo_link text, municipio text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
    WITH alcance AS (
        SELECT s.miembro_id
          FROM acceso.usuarios u
          JOIN campana.miembros m ON m.persona_id = u.persona_id
         CROSS JOIN LATERAL campana.subordinados(m.id) s
         WHERE u.id = acceso.usuario_actual()
        UNION
        SELECT s.miembro_id
          FROM campana.miembro_territorios mt
          JOIN acceso.territorios_visibles() tv ON tv.territorio_id = mt.territorio_id
         CROSS JOIN LATERAL campana.subordinados(mt.miembro_id) s
    )
    SELECT m.id, p.nombres || ' ' || p.apellidos, m.cargo_codigo, l.codigo,
           campana.municipio_de_miembro(m.id)
      FROM alcance a
      JOIN campana.miembros m        ON m.id = a.miembro_id AND m.activo
      JOIN personas.personas p       ON p.id = m.persona_id
      JOIN campana.links_referido l  ON l.miembro_id = m.id AND l.es_principal AND l.activo
                                    AND (l.expira_en IS NULL OR l.expira_en > now())
     WHERE m.cargo_codigo IN ('COORDINADOR', 'LIDER', 'SUBLIDER')
     ORDER BY 2;
$$;
REVOKE EXECUTE ON FUNCTION campana.lideres_para_registro() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION campana.lideres_para_registro() TO rol_app;

COMMIT;
