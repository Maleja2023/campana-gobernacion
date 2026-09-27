-- ============================================================================
-- 36. Comunicaciones
-- ============================================================================
-- 1. Notificaciones internas (la campana de la app) para líderes,
--    coordinadores y el equipo. Automáticas (solicitudes de líder, alertas,
--    solicitudes de titulares, envíos terminados) y avisos al equipo.
-- 2. Mensajes a votantes por SMS, correo o Telegram:
--    - solo a quien autorizó COMUNICACIONES y no pidió la baja (el trigger
--      fn_filtrar_destinatario ya lo hace al preparar, y se vuelve a revisar
--      justo antes de enviar);
--    - la plantilla necesita la aprobación de una persona distinta a quien
--      la escribió;
--    - Telegram publica en el canal de la campaña (quien quiere, se une).
-- 3. Correo opcional en el registro.
-- Requiere 35. Se puede ejecutar más de una vez.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Notificaciones internas
-- ----------------------------------------------------------------------------
ALTER TABLE comunicaciones.notificaciones
  ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'AVISO',
  ADD COLUMN IF NOT EXISTS enlace text,
  ADD COLUMN IF NOT EXISTS enviada_por uuid REFERENCES acceso.usuarios(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS ix_notificaciones_usuario ON comunicaciones.notificaciones (usuario_id, creada_en DESC);

-- Cada usuario ve y marca como leídas solo las suyas.
ALTER TABLE comunicaciones.notificaciones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_notificaciones_propias ON comunicaciones.notificaciones;
CREATE POLICY p_notificaciones_propias ON comunicaciones.notificaciones
    USING (usuario_id = acceso.usuario_actual());
REVOKE INSERT, DELETE ON comunicaciones.notificaciones FROM rol_app;
GRANT SELECT, UPDATE (leida_en) ON comunicaciones.notificaciones TO rol_app;

CREATE OR REPLACE FUNCTION comunicaciones.notificar(p_usuarios uuid[], p_tipo text, p_titulo text, p_cuerpo text, p_enlace text)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
    v_filas integer;
BEGIN
    INSERT INTO comunicaciones.notificaciones (usuario_id, tipo, titulo, cuerpo, enlace, enviada_por)
    SELECT DISTINCT u.id, p_tipo, left(p_titulo, 160), left(p_cuerpo, 2000), p_enlace, acceso.usuario_actual()
      FROM acceso.usuarios u
     WHERE u.id = ANY (p_usuarios) AND u.activo;
    GET DIAGNOSTICS v_filas = ROW_COUNT;
    RETURN v_filas;
END $$;
REVOKE EXECUTE ON FUNCTION comunicaciones.notificar(uuid[], text, text, text, text) FROM PUBLIC;

-- Usuarios activos que tienen un permiso (por alguno de sus roles).
CREATE OR REPLACE FUNCTION comunicaciones.usuarios_con_permiso(p_permiso text) RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
    SELECT coalesce(array_agg(DISTINCT u.id), '{}')
      FROM acceso.usuarios u
      JOIN acceso.usuario_roles ur ON ur.usuario_id = u.id
      JOIN acceso.rol_permisos rp ON rp.rol_codigo = ur.rol_codigo
     WHERE rp.permiso_codigo = p_permiso AND u.activo;
$$;
REVOKE EXECUTE ON FUNCTION comunicaciones.usuarios_con_permiso(text) FROM PUBLIC;

-- Usuario de un miembro de la red (si tiene cuenta).
CREATE OR REPLACE FUNCTION comunicaciones.usuario_de_miembro(p_miembro_id uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
    SELECT u.id FROM campana.miembros m JOIN acceso.usuarios u ON u.persona_id = m.persona_id
     WHERE m.id = p_miembro_id AND u.activo LIMIT 1;
$$;
REVOKE EXECUTE ON FUNCTION comunicaciones.usuario_de_miembro(uuid) FROM PUBLIC;

-- Automáticas ---------------------------------------------------------------

CREATE OR REPLACE FUNCTION comunicaciones.fn_notificar_solicitud_lider() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
    v_usuario uuid := comunicaciones.usuario_de_miembro(NEW.miembro_invita_id);
    v_nombre  text;
BEGIN
    SELECT p.nombres || ' ' || p.apellidos INTO v_nombre FROM personas.personas p WHERE p.id = NEW.persona_id;
    IF v_usuario IS NOT NULL THEN
        PERFORM comunicaciones.notificar(ARRAY[v_usuario], 'SOLICITUD_LIDER', 'Nueva solicitud para tu equipo',
            format('%s quiere ser %s de tu equipo. Revísala en Mi red → Solicitudes.', initcap(lower(v_nombre)), lower(NEW.cargo_propuesto)),
            '/red');
    END IF;
    RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_notificar_solicitud_lider ON campana.solicitudes_lider;
CREATE TRIGGER trg_notificar_solicitud_lider AFTER INSERT ON campana.solicitudes_lider
FOR EACH ROW EXECUTE FUNCTION comunicaciones.fn_notificar_solicitud_lider();

CREATE OR REPLACE FUNCTION comunicaciones.fn_notificar_alerta() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
    PERFORM comunicaciones.notificar(comunicaciones.usuarios_con_permiso('ALERTA_GESTIONAR'), 'ALERTA',
        'Nueva alerta de calidad',
        coalesce((SELECT t.nombre FROM calidad.tipos_alerta t WHERE t.codigo = NEW.tipo_codigo), NEW.tipo_codigo)
          || coalesce(': ' || NEW.observacion, ''),
        '/alertas');
    RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_notificar_alerta ON calidad.alertas;
CREATE TRIGGER trg_notificar_alerta AFTER INSERT ON calidad.alertas
FOR EACH ROW EXECUTE FUNCTION comunicaciones.fn_notificar_alerta();

CREATE OR REPLACE FUNCTION comunicaciones.fn_notificar_solicitud_titular() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
    PERFORM comunicaciones.notificar(comunicaciones.usuarios_con_permiso('SOLICITUD_TITULAR'), 'SOLICITUD_TITULAR',
        'Nueva solicitud de un titular de datos',
        format('Radicado %s. Tiene plazo legal: revísala en Protección de datos.', NEW.radicado),
        '/cumplimiento');
    RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_notificar_solicitud_titular ON cumplimiento.solicitudes_titular;
CREATE TRIGGER trg_notificar_solicitud_titular AFTER INSERT ON cumplimiento.solicitudes_titular
FOR EACH ROW EXECUTE FUNCTION comunicaciones.fn_notificar_solicitud_titular();

-- Avisos al equipo ------------------------------------------------------------
-- Quien gestiona la red (coordinador, gerente) o envía comunicaciones puede
-- avisar a los usuarios de su propia red, filtrando por cargo.
CREATE OR REPLACE FUNCTION comunicaciones.enviar_aviso_equipo(p_titulo text, p_cuerpo text, p_cargos text[], p_enlace text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
    v_destinos uuid[];
BEGIN
    IF NOT (acceso.tiene_permiso('MIEMBRO_GESTIONAR') OR acceso.tiene_permiso('COMUNICACION_ENVIAR')) THEN
        RAISE EXCEPTION 'Sin permiso para enviar avisos al equipo' USING ERRCODE = '42501';
    END IF;
    IF length(btrim(p_titulo)) < 3 OR length(btrim(p_cuerpo)) < 3 THEN
        RAISE EXCEPTION 'El aviso necesita título y mensaje';
    END IF;
    SELECT coalesce(array_agg(DISTINCT u.id), '{}') INTO v_destinos
      FROM campana.miembros_visibles() v
      JOIN campana.miembros m ON m.id = v.miembro_id AND m.activo
      JOIN acceso.usuarios u ON u.persona_id = m.persona_id AND u.activo
     WHERE u.id <> acceso.usuario_actual()
       AND (p_cargos IS NULL OR cardinality(p_cargos) = 0 OR m.cargo_codigo = ANY (p_cargos));
    RETURN comunicaciones.notificar(v_destinos, 'AVISO', btrim(p_titulo), btrim(p_cuerpo), p_enlace);
END $$;
REVOKE EXECUTE ON FUNCTION comunicaciones.enviar_aviso_equipo(text, text, text[], text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION comunicaciones.enviar_aviso_equipo(text, text, text[], text) TO rol_app;

-- ----------------------------------------------------------------------------
-- 2. Mensajes a votantes
-- ----------------------------------------------------------------------------
ALTER TABLE comunicaciones.plantillas
  ADD COLUMN IF NOT EXISTS asunto text,
  ADD COLUMN IF NOT EXISTS creada_por uuid REFERENCES acceso.usuarios(id),
  ADD COLUMN IF NOT EXISTS creada_en timestamptz NOT NULL DEFAULT now();
ALTER TABLE comunicaciones.plantillas DROP CONSTRAINT IF EXISTS ck_plantilla_canal;
ALTER TABLE comunicaciones.plantillas ADD CONSTRAINT ck_plantilla_canal CHECK (canal_codigo IN ('SMS', 'EMAIL', 'TELEGRAM'));
ALTER TABLE comunicaciones.plantillas DROP CONSTRAINT IF EXISTS ck_plantilla_largo;
ALTER TABLE comunicaciones.plantillas ADD CONSTRAINT ck_plantilla_largo
  CHECK (length(contenido) BETWEEN 5 AND CASE canal_codigo WHEN 'SMS' THEN 300 ELSE 4000 END);

ALTER TABLE comunicaciones.envios
  ADD COLUMN IF NOT EXISTS creado_en timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS terminado_en timestamptz,
  ADD COLUMN IF NOT EXISTS resultado text;

-- Aprobar plantillas: el candidato (y el gerente y el superadministrador).
-- Así el gerente redacta y el candidato aprueba lo que sale a su nombre.
INSERT INTO acceso.permisos (codigo, descripcion)
VALUES ('COMUNICACION_APROBAR', 'Aprobar plantillas de mensajes a votantes')
ON CONFLICT (codigo) DO NOTHING;
INSERT INTO acceso.rol_permisos (rol_codigo, permiso_codigo)
VALUES ('CANDIDATO', 'COMUNICACION_APROBAR'), ('GERENTE', 'COMUNICACION_APROBAR'), ('SUPERADMIN', 'COMUNICACION_APROBAR')
ON CONFLICT DO NOTHING;

-- Solo el equipo de comunicaciones ve plantillas y envíos. El proceso que
-- envía corre sin usuario (acceso.usuario_actual() nulo).
DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['plantillas', 'envios', 'envio_destinatarios', 'envio_territorios'] LOOP
        EXECUTE format('ALTER TABLE comunicaciones.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS p_%s_comunicaciones ON comunicaciones.%I', t, t);
        EXECUTE format('CREATE POLICY p_%s_comunicaciones ON comunicaciones.%I
                          USING (acceso.usuario_actual() IS NULL OR acceso.tiene_permiso(''COMUNICACION_ENVIAR'')
                                 OR (%L = ''plantillas'' AND acceso.tiene_permiso(''COMUNICACION_APROBAR'')))', t, t, t);
    END LOOP;
END $$;

CREATE OR REPLACE FUNCTION comunicaciones.exigir_permiso_envio() RETURNS void
LANGUAGE plpgsql STABLE AS $$
BEGIN
    IF NOT acceso.tiene_permiso('COMUNICACION_ENVIAR') THEN
        RAISE EXCEPTION 'Sin permiso para enviar comunicaciones' USING ERRCODE = '42501';
    END IF;
END $$;

-- Aprobación: otra persona distinta a quien la escribió (cuatro ojos).
CREATE OR REPLACE FUNCTION comunicaciones.aprobar_plantilla(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
    v_creador uuid;
BEGIN
    IF NOT acceso.tiene_permiso('COMUNICACION_APROBAR') THEN
        RAISE EXCEPTION 'Sin permiso para aprobar plantillas' USING ERRCODE = '42501';
    END IF;
    SELECT creada_por INTO v_creador FROM comunicaciones.plantillas WHERE id = p_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Plantilla no encontrada';
    END IF;
    IF v_creador = acceso.usuario_actual() THEN
        RAISE EXCEPTION 'La plantilla debe aprobarla una persona distinta a quien la escribió';
    END IF;
    UPDATE comunicaciones.plantillas SET aprobada_por = acceso.usuario_actual(), aprobada_en = now() WHERE id = p_id;
END $$;
REVOKE EXECUTE ON FUNCTION comunicaciones.aprobar_plantilla(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION comunicaciones.aprobar_plantilla(uuid) TO rol_app;

-- Prepara un envío (BORRADOR): destinatarios de los territorios elegidos que
-- el usuario puede ver. El trigger deja OMITIDO a quien no autorizó o pidió
-- la baja. En Telegram no hay destinatarios: se publica en el canal.
CREATE OR REPLACE FUNCTION comunicaciones.preparar_envio(p_plantilla_id uuid, p_territorios integer[], p_programado_para timestamptz)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
    v_id     uuid;
    v_canal  text;
BEGIN
    PERFORM comunicaciones.exigir_permiso_envio();
    SELECT canal_codigo INTO v_canal FROM comunicaciones.plantillas WHERE id = p_plantilla_id;
    IF v_canal IS NULL THEN
        RAISE EXCEPTION 'Plantilla no encontrada';
    END IF;
    IF v_canal <> 'TELEGRAM' AND (p_territorios IS NULL OR cardinality(p_territorios) = 0) THEN
        RAISE EXCEPTION 'Elige al menos un territorio';
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(coalesce(p_territorios, '{}')) t(id)
                WHERE t.id NOT IN (SELECT territorio_id FROM acceso.territorios_visibles())) THEN
        RAISE EXCEPTION 'Hay territorios fuera de tu alcance' USING ERRCODE = '42501';
    END IF;

    INSERT INTO comunicaciones.envios (plantilla_id, creado_por, programado_para, estado)
    VALUES (p_plantilla_id, acceso.usuario_actual(), coalesce(p_programado_para, now()), 'BORRADOR')
    RETURNING id INTO v_id;

    IF v_canal <> 'TELEGRAM' THEN
        INSERT INTO comunicaciones.envio_territorios (envio_id, territorio_id)
        SELECT DISTINCT v_id, t FROM unnest(p_territorios) t;
        PERFORM comunicaciones.generar_destinatarios(v_id);
    END IF;
    RETURN v_id;
END $$;
REVOKE EXECUTE ON FUNCTION comunicaciones.preparar_envio(uuid, integer[], timestamptz) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION comunicaciones.preparar_envio(uuid, integer[], timestamptz) TO rol_app;

-- Listado de envíos con sus cifras.
CREATE OR REPLACE FUNCTION comunicaciones.listado_envios()
RETURNS TABLE (id uuid, plantilla text, canal text, estado text, programado_para timestamptz, creado_en timestamptz,
               terminado_en timestamptz, creado_por text, territorios text, pendientes bigint, enviados bigint,
               fallidos bigint, omitidos bigint, resultado text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
    SELECT e.id, p.nombre, p.canal_codigo, e.estado, e.programado_para, e.creado_en, e.terminado_en, u.login,
           (SELECT string_agg(t.nombre, ', ' ORDER BY t.nombre) FROM comunicaciones.envio_territorios et
              JOIN territorio.territorios t ON t.id = et.territorio_id WHERE et.envio_id = e.id),
           count(d.*) FILTER (WHERE d.estado = 'PENDIENTE'),
           count(d.*) FILTER (WHERE d.estado = 'ENVIADO'),
           count(d.*) FILTER (WHERE d.estado = 'FALLIDO'),
           count(d.*) FILTER (WHERE d.estado = 'OMITIDO_SIN_AUTORIZACION'),
           e.resultado
      FROM comunicaciones.envios e
      JOIN comunicaciones.plantillas p ON p.id = e.plantilla_id
      JOIN acceso.usuarios u ON u.id = e.creado_por
      LEFT JOIN comunicaciones.envio_destinatarios d ON d.envio_id = e.id
     WHERE acceso.tiene_permiso('COMUNICACION_ENVIAR')
     GROUP BY e.id, p.nombre, p.canal_codigo, u.login
     ORDER BY e.creado_en DESC
     LIMIT 100;
$$;
REVOKE EXECUTE ON FUNCTION comunicaciones.listado_envios() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION comunicaciones.listado_envios() TO rol_app;

CREATE OR REPLACE FUNCTION comunicaciones.cambiar_estado_envio(p_id uuid, p_estado text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
    v_actual text;
BEGIN
    PERFORM comunicaciones.exigir_permiso_envio();
    SELECT estado INTO v_actual FROM comunicaciones.envios WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Envío no encontrado';
    END IF;
    IF NOT ((v_actual = 'BORRADOR' AND p_estado IN ('PROGRAMADO', 'CANCELADO'))
         OR (v_actual = 'PROGRAMADO' AND p_estado IN ('BORRADOR', 'CANCELADO'))
         OR (v_actual = 'EN_CURSO' AND p_estado = 'CANCELADO')) THEN
        RAISE EXCEPTION 'No se puede pasar un envío de % a %', v_actual, p_estado;
    END IF;
    UPDATE comunicaciones.envios SET estado = p_estado,
           terminado_en = CASE WHEN p_estado = 'CANCELADO' THEN now() END
     WHERE id = p_id;
END $$;
REVOKE EXECUTE ON FUNCTION comunicaciones.cambiar_estado_envio(uuid, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION comunicaciones.cambiar_estado_envio(uuid, text) TO rol_app;

-- Proceso de envío (sin usuario) ---------------------------------------------
CREATE OR REPLACE FUNCTION comunicaciones.exigir_proceso_sistema() RETURNS void
LANGUAGE plpgsql STABLE AS $$
BEGIN
    IF acceso.usuario_actual() IS NOT NULL THEN
        RAISE EXCEPTION 'Solo el proceso de envío puede hacer esto' USING ERRCODE = '42501';
    END IF;
END $$;

-- Pasa a EN_CURSO los envíos programados cuya hora llegó.
CREATE OR REPLACE FUNCTION comunicaciones.tomar_envios_listos()
RETURNS TABLE (id uuid, canal text, contenido text, asunto text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
    PERFORM comunicaciones.exigir_proceso_sistema();
    UPDATE comunicaciones.envios e SET estado = 'EN_CURSO'
     WHERE e.estado = 'PROGRAMADO' AND e.programado_para <= now();
    RETURN QUERY
    SELECT e.id, p.canal_codigo, p.contenido, p.asunto
      FROM comunicaciones.envios e JOIN comunicaciones.plantillas p ON p.id = e.plantilla_id
     WHERE e.estado = 'EN_CURSO' AND p.aprobada_en IS NOT NULL
     ORDER BY e.programado_para;
END $$;
REVOKE EXECUTE ON FUNCTION comunicaciones.tomar_envios_listos() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION comunicaciones.tomar_envios_listos() TO rol_app;

-- Siguiente lote. Revisa de nuevo autorización y bajas: si alguien se dio de
-- baja después de preparar el envío, queda OMITIDO y no se le escribe.
CREATE OR REPLACE FUNCTION comunicaciones.lote_destinatarios(p_envio_id uuid, p_cantidad integer)
RETURNS TABLE (persona_id uuid, nombre text, telefono_cifrado bytea, correo text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
    v_canal text;
BEGIN
    PERFORM comunicaciones.exigir_proceso_sistema();
    SELECT p.canal_codigo INTO v_canal FROM comunicaciones.envios e JOIN comunicaciones.plantillas p ON p.id = e.plantilla_id
     WHERE e.id = p_envio_id;

    UPDATE comunicaciones.envio_destinatarios d SET estado = 'OMITIDO_SIN_AUTORIZACION', procesado_en = now()
     WHERE d.envio_id = p_envio_id AND d.estado = 'PENDIENTE'
       AND (EXISTS (SELECT 1 FROM comunicaciones.bajas b WHERE b.persona_id = d.persona_id AND b.canal_codigo = v_canal)
            OR NOT EXISTS (SELECT 1 FROM cumplimiento.autorizaciones a
                             JOIN cumplimiento.autorizacion_finalidades af ON af.autorizacion_id = a.id AND af.finalidad_codigo = 'COMUNICACIONES'
                            WHERE a.persona_id = d.persona_id AND a.revocada_en IS NULL)
            OR NOT EXISTS (SELECT 1 FROM campana.simpatizantes s WHERE s.persona_id = d.persona_id AND s.estado_codigo = 'ACTIVO'));

    RETURN QUERY
    SELECT d.persona_id, split_part(initcap(lower(p.nombres)), ' ', 1),
           (SELECT t.telefono_cifrado FROM personas.telefonos t WHERE t.persona_id = d.persona_id ORDER BY t.es_principal DESC LIMIT 1),
           (SELECT c.correo::text FROM personas.correos c WHERE c.persona_id = d.persona_id ORDER BY c.es_principal DESC LIMIT 1)
      FROM comunicaciones.envio_destinatarios d
      JOIN personas.personas p ON p.id = d.persona_id
     WHERE d.envio_id = p_envio_id AND d.estado = 'PENDIENTE'
     ORDER BY d.persona_id
     LIMIT p_cantidad;
END $$;
REVOKE EXECUTE ON FUNCTION comunicaciones.lote_destinatarios(uuid, integer) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION comunicaciones.lote_destinatarios(uuid, integer) TO rol_app;

CREATE OR REPLACE FUNCTION comunicaciones.marcar_destinatario(p_envio_id uuid, p_persona_id uuid, p_estado text, p_error text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
    PERFORM comunicaciones.exigir_proceso_sistema();
    UPDATE comunicaciones.envio_destinatarios
       SET estado = p_estado, procesado_en = now(), error = left(p_error, 300)
     WHERE envio_id = p_envio_id AND persona_id = p_persona_id AND estado = 'PENDIENTE';
END $$;
REVOKE EXECUTE ON FUNCTION comunicaciones.marcar_destinatario(uuid, uuid, text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION comunicaciones.marcar_destinatario(uuid, uuid, text, text) TO rol_app;

-- Cierra el envío si ya no quedan pendientes (o si se pide con un resultado,
-- como en Telegram) y avisa a quien lo creó.
CREATE OR REPLACE FUNCTION comunicaciones.cerrar_envio(p_envio_id uuid, p_resultado text DEFAULT NULL) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
    v_envio  comunicaciones.envios%ROWTYPE;
    v_cifras record;
BEGIN
    PERFORM comunicaciones.exigir_proceso_sistema();
    IF p_resultado IS NULL AND EXISTS (SELECT 1 FROM comunicaciones.envio_destinatarios
                                        WHERE envio_id = p_envio_id AND estado = 'PENDIENTE') THEN
        RETURN false;
    END IF;
    SELECT count(*) FILTER (WHERE estado = 'ENVIADO') AS enviados,
           count(*) FILTER (WHERE estado = 'FALLIDO') AS fallidos,
           count(*) FILTER (WHERE estado = 'OMITIDO_SIN_AUTORIZACION') AS omitidos
      INTO v_cifras FROM comunicaciones.envio_destinatarios WHERE envio_id = p_envio_id;
    UPDATE comunicaciones.envios SET estado = 'TERMINADO', terminado_en = now(),
           resultado = coalesce(p_resultado, format('%s enviados, %s fallidos, %s omitidos por no tener autorización o haber pedido la baja',
                                                    v_cifras.enviados, v_cifras.fallidos, v_cifras.omitidos))
     WHERE id = p_envio_id AND estado = 'EN_CURSO'
     RETURNING * INTO v_envio;
    IF FOUND THEN
        PERFORM comunicaciones.notificar(ARRAY[v_envio.creado_por], 'ENVIO', 'Envío terminado', v_envio.resultado, '/comunicaciones');
    END IF;
    RETURN true;
END $$;
REVOKE EXECUTE ON FUNCTION comunicaciones.cerrar_envio(uuid, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION comunicaciones.cerrar_envio(uuid, text) TO rol_app;

-- Baja por el enlace del mensaje: el backend verifica la firma del enlace y
-- pasa la persona y el canal.
GRANT EXECUTE ON FUNCTION comunicaciones.dar_de_baja(uuid, text) TO rol_app;

-- ----------------------------------------------------------------------------
-- 3. Correo opcional en el registro (solo en la misma transacción del registro)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION personas.agregar_correo_registro(p_persona_id uuid, p_correo text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
    IF NOT campana.registrado_en_esta_transaccion(p_persona_id) THEN
        RETURN;
    END IF;
    IF p_correo !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
        RAISE EXCEPTION 'El correo no es válido';
    END IF;
    INSERT INTO personas.correos (persona_id, correo, es_principal)
    VALUES (p_persona_id, lower(btrim(p_correo)), true)
    ON CONFLICT DO NOTHING;
END $$;
REVOKE EXECUTE ON FUNCTION personas.agregar_correo_registro(uuid, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION personas.agregar_correo_registro(uuid, text) TO rol_app;
