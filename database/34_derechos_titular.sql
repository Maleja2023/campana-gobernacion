-- =============================================================================
--  34_derechos_titular.sql
--  Ley 1581 de 2012: canal para que el titular ejerza sus derechos y
--  herramientas para que la campaña los atienda a tiempo.
--
--    - Corrige la supresión de datos: cumplimiento.suprimir_persona() fallaba
--      siempre porque el historial del simpatizante no admitía DELETE (la
--      eliminación en cascada lo bloqueaba). Ahora la supresión autorizada
--      borra también ese historial. La bitácora de auditoría no se toca: solo
--      guarda identificadores y nombres de campos, nunca datos personales.
--    - Radicación pública de solicitudes (consulta, actualización, supresión,
--      revocatoria) con radicado y fecha límite en días hábiles, y consulta
--      del estado con el radicado y la cédula.
--    - Bajas de comunicaciones (todas o por canal) desde el canal público y
--      desde el enlace de cada mensaje.
--    - Panel para tramitarlas: listado con vencimiento, datos que la campaña
--      tiene del titular (para responder la consulta) y respuesta, supresión
--      o revocatoria.
--    - Bitácora de auditoría consultable por quien administra usuarios.
--
--  Requiere: 01 a 33. Se puede ejecutar más de una vez.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Supresión
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION auditoria.fn_solo_insercion()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    -- Única excepción: el historial de un simpatizante se borra cuando el
    -- titular pide la supresión de sus datos (cumplimiento.suprimir_persona).
    IF TG_OP = 'DELETE' AND TG_TABLE_NAME = 'historial_simpatizante'
       AND current_setting('app.supresion_titular', true) = 'on' THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION 'La tabla de auditoría % no admite %', TG_TABLE_NAME, TG_OP;
END $$;

CREATE OR REPLACE PROCEDURE cumplimiento.suprimir_persona(IN p_solicitud_id uuid, IN p_respuesta text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
    v_solicitud cumplimiento.solicitudes_titular%ROWTYPE;
BEGIN
    IF acceso.usuario_actual() IS NOT NULL AND NOT acceso.tiene_permiso('SOLICITUD_TITULAR') THEN
        RAISE EXCEPTION 'No tiene permiso para tramitar solicitudes de titulares';
    END IF;
    SELECT * INTO v_solicitud FROM cumplimiento.solicitudes_titular WHERE id = p_solicitud_id;
    IF NOT FOUND OR v_solicitud.tipo_codigo <> 'SUPRESION' THEN
        RAISE EXCEPTION 'La solicitud % no existe o no es de supresión', p_solicitud_id;
    END IF;
    IF v_solicitud.persona_id IS NULL THEN
        RAISE EXCEPTION 'La solicitud no está asociada a una persona registrada';
    END IF;
    IF EXISTS (SELECT 1 FROM acceso.usuarios  WHERE persona_id = v_solicitud.persona_id)
    OR EXISTS (SELECT 1 FROM campana.miembros WHERE persona_id = v_solicitud.persona_id) THEN
        RAISE EXCEPTION 'La persona es usuario o miembro de la campaña: primero retírela de la estructura';
    END IF;

    UPDATE cumplimiento.solicitudes_titular
       SET estado = 'RESPONDIDA', respondida_en = now(), respuesta = p_respuesta
     WHERE id = p_solicitud_id;

    PERFORM set_config('app.supresion_titular', 'on', true);
    DELETE FROM personas.personas WHERE id = v_solicitud.persona_id;
    PERFORM set_config('app.supresion_titular', 'off', true);
END $$;

-- ---------------------------------------------------------------------------
-- Radicación pública (visitante anónimo)
-- ---------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS cumplimiento.radicado_seq;

-- Huella (HMAC) de la cédula de quien radica: permite consultar el estado
-- aunque la persona no esté en la base o sus datos ya se hayan suprimido.
ALTER TABLE cumplimiento.solicitudes_titular ADD COLUMN IF NOT EXISTS documento_hash bytea;

CREATE OR REPLACE FUNCTION cumplimiento.radicar_solicitud(p_tipo text, p_documento_hash bytea, p_contacto text, p_descripcion text)
RETURNS TABLE (radicado text, fecha_limite date)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
    v_radicado text := format('T-%s-%s', to_char(now() AT TIME ZONE 'America/Bogota', 'YYYY'),
                              lpad(nextval('cumplimiento.radicado_seq')::text, 5, '0'));
    v_plazo integer;
BEGIN
    SELECT plazo_dias_habiles INTO v_plazo FROM cumplimiento.tipos_solicitud WHERE codigo = p_tipo;
    IF v_plazo IS NULL THEN
        RAISE EXCEPTION 'Tipo de solicitud no válido';
    END IF;
    INSERT INTO cumplimiento.solicitudes_titular (radicado, persona_id, tipo_codigo, contacto_respuesta, descripcion, documento_hash)
    VALUES (v_radicado,
            (SELECT p.id FROM personas.personas p WHERE p.tipo_documento_codigo = 'CC' AND p.documento_hash = p_documento_hash),
            p_tipo, btrim(p_contacto), btrim(p_descripcion), p_documento_hash);
    RETURN QUERY SELECT v_radicado, cumplimiento.sumar_dias_habiles((now() AT TIME ZONE 'America/Bogota')::date, v_plazo);
END $$;
REVOKE EXECUTE ON FUNCTION cumplimiento.radicar_solicitud(text, bytea, text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION cumplimiento.radicar_solicitud(text, bytea, text, text) TO rol_app;

-- Estado de una solicitud: solo si el radicado corresponde a esa cédula.
CREATE OR REPLACE FUNCTION cumplimiento.estado_solicitud(p_radicado text, p_documento_hash bytea)
RETURNS TABLE (radicado text, tipo text, estado text, recibida_en timestamptz, fecha_limite date,
               respondida_en timestamptz, respuesta text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
    SELECT s.radicado, t.nombre, s.estado, s.recibida_en,
           cumplimiento.sumar_dias_habiles((s.recibida_en AT TIME ZONE 'America/Bogota')::date, t.plazo_dias_habiles),
           s.respondida_en, s.respuesta
      FROM cumplimiento.solicitudes_titular s
      JOIN cumplimiento.tipos_solicitud t ON t.codigo = s.tipo_codigo
     WHERE s.radicado = upper(btrim(p_radicado)) AND s.documento_hash = p_documento_hash;
$$;
REVOKE EXECUTE ON FUNCTION cumplimiento.estado_solicitud(text, bytea) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION cumplimiento.estado_solicitud(text, bytea) TO rol_app;

-- ---------------------------------------------------------------------------
-- Bajas de comunicaciones (quedan excluidas automáticamente de los envíos:
-- comunicaciones.fn_filtrar_destinatario ya las revisa).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION comunicaciones.dar_de_baja(p_persona_id uuid, p_canal text)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
    v_filas integer;
BEGIN
    INSERT INTO comunicaciones.bajas (persona_id, canal_codigo)
    SELECT p_persona_id, c.codigo FROM comunicaciones.canales c
     WHERE (p_canal IS NULL OR c.codigo = p_canal) AND c.codigo <> 'PUSH'
       AND EXISTS (SELECT 1 FROM personas.personas p WHERE p.id = p_persona_id)
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_filas = ROW_COUNT;
    RETURN v_filas;
END $$;
REVOKE EXECUTE ON FUNCTION comunicaciones.dar_de_baja(uuid, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION comunicaciones.dar_de_baja(uuid, text) TO rol_app;

CREATE OR REPLACE FUNCTION comunicaciones.dar_de_baja_por_documento(p_documento_hash bytea, p_canal text)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
    SELECT comunicaciones.dar_de_baja(p.id, p_canal)
      FROM personas.personas p WHERE p.tipo_documento_codigo = 'CC' AND p.documento_hash = p_documento_hash;
$$;
REVOKE EXECUTE ON FUNCTION comunicaciones.dar_de_baja_por_documento(bytea, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION comunicaciones.dar_de_baja_por_documento(bytea, text) TO rol_app;

-- ---------------------------------------------------------------------------
-- Panel de solicitudes (permiso SOLICITUD_TITULAR)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION cumplimiento.exigir_permiso_titular() RETURNS void
LANGUAGE plpgsql STABLE AS $$
BEGIN
    IF NOT acceso.tiene_permiso('SOLICITUD_TITULAR') THEN
        RAISE EXCEPTION 'Sin permiso para tramitar solicitudes de titulares' USING ERRCODE = '42501';
    END IF;
END $$;

CREATE OR REPLACE FUNCTION cumplimiento.listado_solicitudes(p_estado text)
RETURNS TABLE (id uuid, radicado text, tipo_codigo text, tipo text, estado text, contacto_respuesta text,
               descripcion text, recibida_en timestamptz, fecha_limite date, dias_habiles_restantes integer,
               respondida_en timestamptz, respuesta text, persona_encontrada boolean, nombre text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
    PERFORM cumplimiento.exigir_permiso_titular();
    RETURN QUERY
    SELECT s.id, s.radicado, s.tipo_codigo, t.nombre, s.estado, s.contacto_respuesta, s.descripcion, s.recibida_en,
           lim.fecha,
           (SELECT count(*)::integer FROM generate_series((now() AT TIME ZONE 'America/Bogota')::date + 1, lim.fecha, interval '1 day') d
             WHERE cumplimiento.es_dia_habil(d::date))
             - CASE WHEN lim.fecha < (now() AT TIME ZONE 'America/Bogota')::date
                    THEN (SELECT count(*)::integer FROM generate_series(lim.fecha + 1, (now() AT TIME ZONE 'America/Bogota')::date, interval '1 day') d
                           WHERE cumplimiento.es_dia_habil(d::date))
                    ELSE 0 END,
           s.respondida_en, s.respuesta, s.persona_id IS NOT NULL,
           (SELECT p.nombres || ' ' || p.apellidos FROM personas.personas p WHERE p.id = s.persona_id)
      FROM cumplimiento.solicitudes_titular s
      JOIN cumplimiento.tipos_solicitud t ON t.codigo = s.tipo_codigo
      CROSS JOIN LATERAL (SELECT cumplimiento.sumar_dias_habiles((s.recibida_en AT TIME ZONE 'America/Bogota')::date, t.plazo_dias_habiles) AS fecha) lim
     WHERE p_estado IS NULL OR s.estado = p_estado
        OR (p_estado = 'ABIERTAS' AND s.estado IN ('RECIBIDA', 'EN_TRAMITE'))
     ORDER BY (s.estado IN ('RECIBIDA', 'EN_TRAMITE')) DESC, lim.fecha, s.recibida_en
     LIMIT 300;
END $$;
REVOKE EXECUTE ON FUNCTION cumplimiento.listado_solicitudes(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION cumplimiento.listado_solicitudes(text) TO rol_app;

-- Lo que la campaña tiene del titular (para responder una consulta). El
-- documento y los teléfonos van cifrados: la API los descifra. Queda en la
-- bitácora como CONSULTA.
CREATE OR REPLACE FUNCTION cumplimiento.datos_del_titular(p_solicitud_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
    v_persona uuid;
BEGIN
    PERFORM cumplimiento.exigir_permiso_titular();
    SELECT persona_id INTO v_persona FROM cumplimiento.solicitudes_titular WHERE id = p_solicitud_id;
    IF v_persona IS NULL THEN
        RETURN NULL;
    END IF;
    PERFORM auditoria.registrar_consulta('personas', 'personas', v_persona::text);
    RETURN jsonb_build_object(
        'nombres', (SELECT nombres FROM personas.personas WHERE id = v_persona),
        'apellidos', (SELECT apellidos FROM personas.personas WHERE id = v_persona),
        'documento_cifrado', (SELECT encode(documento_cifrado, 'base64') FROM personas.personas WHERE id = v_persona),
        'telefonos_cifrados', (SELECT coalesce(jsonb_agg(encode(telefono_cifrado, 'base64')), '[]') FROM personas.telefonos WHERE persona_id = v_persona),
        'correos', (SELECT coalesce(jsonb_agg(correo), '[]') FROM personas.correos WHERE persona_id = v_persona),
        'simpatizante', (SELECT jsonb_build_object(
                'estado', s.estado_codigo, 'registrado_en', s.capturado_en, 'canal', s.canal_codigo,
                'residencia', t.nombre, 'municipio', m.nombre,
                'referido_por', (SELECT pl.nombres || ' ' || pl.apellidos FROM campana.links_referido l
                                   JOIN campana.miembros mb ON mb.id = l.miembro_id JOIN personas.personas pl ON pl.id = mb.persona_id
                                  WHERE l.id = s.link_referido_id),
                'puesto', (SELECT pv.nombre FROM campana.simpatizante_puesto sp JOIN electoral.puestos_votacion pv ON pv.id = sp.puesto_id
                            WHERE sp.persona_id = v_persona LIMIT 1))
              FROM campana.simpatizantes s
              JOIN territorio.territorios t ON t.id = s.territorio_residencia_id
              LEFT JOIN territorio.territorios m ON m.id = territorio.ancestro(s.territorio_residencia_id, 'MUNICIPIO')
             WHERE s.persona_id = v_persona),
        'autorizaciones', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                'otorgada_en', a.otorgada_en, 'revocada_en', a.revocada_en, 'politica_version', a.politica_version,
                'canal', a.canal_codigo,
                'finalidades', (SELECT jsonb_agg(af.finalidad_codigo) FROM cumplimiento.autorizacion_finalidades af WHERE af.autorizacion_id = a.id))
                ORDER BY a.otorgada_en), '[]') FROM cumplimiento.autorizaciones a WHERE a.persona_id = v_persona),
        'necesidades', (SELECT coalesce(jsonb_agg(jsonb_build_object('descripcion', n.descripcion, 'reportada_en', n.reportada_en)), '[]')
                          FROM participacion.necesidades n WHERE n.persona_id = v_persona),
        'eventos', (SELECT coalesce(jsonb_agg(jsonb_build_object('evento', e.nombre, 'fecha', e.inicia_en)), '[]')
                      FROM eventos.asistencias a JOIN eventos.eventos e ON e.id = a.evento_id WHERE a.persona_id = v_persona),
        'bajas', (SELECT coalesce(jsonb_agg(canal_codigo), '[]') FROM comunicaciones.bajas WHERE persona_id = v_persona),
        'es_miembro_o_usuario', EXISTS (SELECT 1 FROM campana.miembros WHERE persona_id = v_persona)
                                OR EXISTS (SELECT 1 FROM acceso.usuarios WHERE persona_id = v_persona)
    );
END $$;
REVOKE EXECUTE ON FUNCTION cumplimiento.datos_del_titular(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION cumplimiento.datos_del_titular(uuid) TO rol_app;

-- Tramitar: EN_TRAMITE, RESPONDER (consulta o actualización ya hecha),
-- RECHAZAR (con motivo), REVOCAR (revoca las autorizaciones: la persona
-- queda retirada y sin comunicaciones) o SUPRIMIR (borra sus datos).
CREATE OR REPLACE FUNCTION cumplimiento.tramitar_solicitud(p_id uuid, p_accion text, p_respuesta text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
    v_s cumplimiento.solicitudes_titular%ROWTYPE;
BEGIN
    PERFORM cumplimiento.exigir_permiso_titular();
    SELECT * INTO v_s FROM cumplimiento.solicitudes_titular WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Solicitud no encontrada'; END IF;
    IF v_s.estado IN ('RESPONDIDA', 'RECHAZADA') THEN RAISE EXCEPTION 'La solicitud ya fue cerrada'; END IF;
    IF p_accion <> 'EN_TRAMITE' AND length(btrim(coalesce(p_respuesta, ''))) < 10 THEN
        RAISE EXCEPTION 'Escriba la respuesta que se le envió al titular (al menos 10 caracteres)';
    END IF;

    CASE p_accion
        WHEN 'EN_TRAMITE' THEN
            UPDATE cumplimiento.solicitudes_titular SET estado = 'EN_TRAMITE' WHERE id = p_id;
        WHEN 'RESPONDER' THEN
            UPDATE cumplimiento.solicitudes_titular SET estado = 'RESPONDIDA', respondida_en = now(), respuesta = p_respuesta WHERE id = p_id;
        WHEN 'RECHAZAR' THEN
            UPDATE cumplimiento.solicitudes_titular SET estado = 'RECHAZADA', respondida_en = now(), respuesta = p_respuesta WHERE id = p_id;
        WHEN 'REVOCAR' THEN
            IF v_s.persona_id IS NULL THEN RAISE EXCEPTION 'La solicitud no está asociada a una persona registrada'; END IF;
            PERFORM cumplimiento.revocar_autorizaciones(v_s.persona_id);
            PERFORM comunicaciones.dar_de_baja(v_s.persona_id, NULL);
            UPDATE cumplimiento.solicitudes_titular SET estado = 'RESPONDIDA', respondida_en = now(), respuesta = p_respuesta WHERE id = p_id;
        WHEN 'SUPRIMIR' THEN
            CALL cumplimiento.suprimir_persona(p_id, p_respuesta);
        ELSE
            RAISE EXCEPTION 'Acción no válida';
    END CASE;
    RETURN p_accion;
END $$;
REVOKE EXECUTE ON FUNCTION cumplimiento.tramitar_solicitud(uuid, text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION cumplimiento.tramitar_solicitud(uuid, text, text) TO rol_app;

-- ---------------------------------------------------------------------------
-- Bitácora de auditoría (quien administra usuarios)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION auditoria.bitacora(p_usuario text, p_accion text, p_tabla text, p_desde date, p_hasta date,
                                              p_limite integer, p_desplazamiento integer)
RETURNS TABLE (id bigint, ocurrido_en timestamptz, usuario text, accion text, esquema text, tabla text,
               registro_id text, campos text, ip text, total bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
    IF NOT acceso.tiene_permiso('USUARIO_GESTIONAR') THEN
        RAISE EXCEPTION 'Sin permiso para ver la bitácora de auditoría' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
    SELECT e.id, e.ocurrido_en, coalesce(u.login::text, 'sistema / registro público'), e.accion, e.esquema, e.tabla, e.registro_id,
           (SELECT string_agg(c.campo, ', ' ORDER BY c.campo) FROM auditoria.evento_campos c WHERE c.evento_id = e.id),
           host(e.ip), count(*) OVER ()
      FROM auditoria.eventos e
      LEFT JOIN acceso.usuarios u ON u.id = e.usuario_id
     WHERE (p_usuario IS NULL OR u.login::text ILIKE '%' || p_usuario || '%')
       AND (p_accion IS NULL OR e.accion = p_accion)
       AND (p_tabla IS NULL OR e.tabla = p_tabla)
       AND (p_desde IS NULL OR e.ocurrido_en >= p_desde)
       AND (p_hasta IS NULL OR e.ocurrido_en < p_hasta + 1)
     ORDER BY e.ocurrido_en DESC, e.id DESC
     LIMIT least(greatest(p_limite, 1), 200) OFFSET greatest(p_desplazamiento, 0);
END $$;
REVOKE EXECUTE ON FUNCTION auditoria.bitacora(text, text, text, date, date, integer, integer) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION auditoria.bitacora(text, text, text, date, date, integer, integer) TO rol_app;

COMMIT;
