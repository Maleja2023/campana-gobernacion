-- =============================================================================
--  02_funciones.sql
--  Funciones y procedimientos almacenados de la plataforma.
--  Requiere: 01_esquema.sql
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS unaccent;   -- búsquedas sin tildes
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- búsquedas aproximadas ("porvenir" ~ "El Porvenir")

CREATE SCHEMA IF NOT EXISTS util;


-- =============================================================================
-- 1. UTILIDADES GENERALES
-- =============================================================================

-- unaccent no es IMMUTABLE; este envoltorio permite usarlo en índices.
CREATE FUNCTION util.sin_tildes(p_texto text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT public.unaccent('public.unaccent'::regdictionary, p_texto);
$$;

-- "  el   porvenir " -> "EL PORVENIR"
CREATE FUNCTION util.normalizar_nombre(p_texto text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT upper(regexp_replace(btrim(p_texto), '\s+', ' ', 'g'));
$$;

-- Código aleatorio legible, sin caracteres que se confunden (0/O, 1/I/L).
CREATE FUNCTION util.generar_codigo(p_longitud integer DEFAULT 8) RETURNS text
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
    v_alfabeto constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    v_bytes    bytea := gen_random_bytes(p_longitud);
    v_codigo   text  := '';
BEGIN
    FOR i IN 0 .. p_longitud - 1 LOOP
        v_codigo := v_codigo || substr(v_alfabeto, (get_byte(v_bytes, i) % length(v_alfabeto)) + 1, 1);
    END LOOP;
    RETURN v_codigo;
END $$;

-- Trigger genérico: actualiza la columna actualizada_en.
CREATE FUNCTION util.fn_actualizar_fecha() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.actualizada_en := now();
    RETURN NEW;
END $$;

-- Lee un parámetro numérico de campana.parametros.
CREATE FUNCTION campana.parametro_int(p_clave text) RETURNS integer
LANGUAGE sql STABLE AS $$
    SELECT valor::integer FROM campana.parametros WHERE clave = p_clave;
$$;


-- =============================================================================
-- 2. TERRITORIO
-- =============================================================================

CREATE INDEX ix_territorios_nombre_trgm
    ON territorio.territorios USING gin (util.sin_tildes(lower(nombre)) gin_trgm_ops);

-- Buscador para formularios: el usuario escribe "porvenir" y aparece "EL PORVENIR".
CREATE FUNCTION territorio.buscar(
    p_texto   text,
    p_tipo    text    DEFAULT NULL,
    p_padre   integer DEFAULT NULL,   -- limitar a los hijos de un territorio (ej. un municipio)
    p_limite  integer DEFAULT 20
)
RETURNS TABLE (id integer, tipo text, nombre text, municipio text, similitud real)
LANGUAGE sql STABLE AS $$
    SELECT t.id, t.tipo_codigo, t.nombre, m.nombre,
           similarity(util.sin_tildes(lower(t.nombre)), util.sin_tildes(lower(p_texto))) AS sim
      FROM territorio.territorios t
      LEFT JOIN territorio.territorios m ON m.id = territorio.ancestro(t.id, 'MUNICIPIO')
     WHERE util.sin_tildes(lower(t.nombre)) % util.sin_tildes(lower(p_texto))
       AND (p_tipo  IS NULL OR t.tipo_codigo = p_tipo)
       AND (p_padre IS NULL OR t.id IN (SELECT territorio_id FROM territorio.descendientes(p_padre)))
     ORDER BY sim DESC, t.nombre
     LIMIT p_limite;
$$;

-- Territorio más específico que contiene un punto (GPS del celular).
CREATE FUNCTION territorio.ubicar_punto(p_lon double precision, p_lat double precision)
RETURNS integer
LANGUAGE sql STABLE AS $$
    SELECT t.id
      FROM territorio.territorios t
      JOIN territorio.tipos_territorio tt ON tt.codigo = t.tipo_codigo
     WHERE t.geom IS NOT NULL
       AND ST_Intersects(t.geom, ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326))
     ORDER BY tt.nivel DESC
     LIMIT 1;
$$;

-- Ruta legible: "CAQUETÁ > FLORENCIA > COMUNA 1 OCCIDENTAL > EL PORVENIR"
CREATE FUNCTION territorio.ruta(p_territorio_id integer) RETURNS text
LANGUAGE sql STABLE AS $$
    WITH RECURSIVE subida AS (
        SELECT t.id, t.padre_id, t.nombre, 0 AS paso
          FROM territorio.territorios t WHERE t.id = p_territorio_id
        UNION ALL
        SELECT p.id, p.padre_id, p.nombre, s.paso + 1
          FROM territorio.territorios p JOIN subida s ON p.id = s.padre_id
    )
    SELECT string_agg(nombre, ' > ' ORDER BY paso DESC) FROM subida;
$$;


-- =============================================================================
-- 3. ELECTORAL
-- =============================================================================

-- Puestos más cercanos a un punto, con distancia en metros.
CREATE FUNCTION electoral.puestos_cercanos(
    p_lon       double precision,
    p_lat       double precision,
    p_jornada   smallint,
    p_limite    integer DEFAULT 5
)
RETURNS TABLE (puesto_id integer, nombre text, direccion text, distancia_m integer)
LANGUAGE sql STABLE AS $$
    SELECT pv.id, pv.nombre, pv.direccion,
           ST_Distance(pv.geom::geography,
                       ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geography)::integer
      FROM electoral.puestos_votacion pv
      JOIN electoral.puestos_jornada pj ON pj.puesto_id = pv.id AND pj.jornada_id = p_jornada
     WHERE pv.geom IS NOT NULL
     ORDER BY pv.geom <-> ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)
     LIMIT p_limite;
$$;


-- =============================================================================
-- 4. ACCESO
-- =============================================================================

CREATE FUNCTION acceso.permisos_de(p_usuario_id uuid)
RETURNS TABLE (permiso_codigo text)
LANGUAGE sql STABLE AS $$
    SELECT DISTINCT rp.permiso_codigo
      FROM acceso.usuario_roles ur
      JOIN acceso.rol_permisos rp ON rp.rol_codigo = ur.rol_codigo
      JOIN acceso.usuarios u      ON u.id = ur.usuario_id AND u.activo
     WHERE ur.usuario_id = p_usuario_id;
$$;

-- La API la llama antes de cada acción: SELECT acceso.tiene_permiso('EXPORTAR');
CREATE FUNCTION acceso.tiene_permiso(p_permiso text) RETURNS boolean
LANGUAGE sql STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM acceso.permisos_de(acceso.usuario_actual())
                    WHERE permiso_codigo = p_permiso);
$$;


-- =============================================================================
-- 5. CAMPAÑA
-- =============================================================================

-- Crea un link de referido con código único.
CREATE FUNCTION campana.crear_link(p_miembro_id uuid, p_principal boolean DEFAULT false)
RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
    v_codigo text;
BEGIN
    LOOP
        v_codigo := util.generar_codigo(8);
        EXIT WHEN NOT EXISTS (SELECT 1 FROM campana.links_referido WHERE codigo = v_codigo);
    END LOOP;
    INSERT INTO campana.links_referido (miembro_id, codigo, es_principal)
    VALUES (p_miembro_id, v_codigo, p_principal);
    RETURN v_codigo;
END $$;

-- -----------------------------------------------------------------------------
-- REGISTRO DE SIMPATIZANTES: punto único de entrada para formulario, chatbot,
-- Telegram, digitador y eventos. Todo ocurre en una sola transacción.
--
-- Resultados posibles:
--   REGISTRADO  -> se creó el simpatizante
--   DUPLICADO   -> la persona ya estaba registrada (se deja constancia del intento,
--                  pero NO se revela quién la registró)
--   LINK_INVALIDO
-- El hash y el cifrado del documento/teléfono los calcula la API.
-- -----------------------------------------------------------------------------
CREATE FUNCTION campana.registrar_simpatizante(
    p_tipo_documento     text,
    p_documento_hash     bytea,
    p_documento_cifrado  bytea,
    p_nombres            text,
    p_apellidos          text,
    p_telefono_hash      bytea,
    p_telefono_cifrado   bytea,
    p_territorio_id      integer,
    p_codigo_link        text,
    p_canal              text,
    p_politica_version   smallint,
    p_finalidades        text[],
    p_evidencia          text,
    p_capturado_en       timestamptz DEFAULT now(),
    p_jornada_id         smallint    DEFAULT NULL,
    p_puesto_id          integer     DEFAULT NULL,
    p_necesidad          text        DEFAULT NULL,
    p_categoria          text        DEFAULT NULL,
    p_lon                double precision DEFAULT NULL,
    p_lat                double precision DEFAULT NULL,
    p_ip                 inet        DEFAULT NULL,
    p_user_agent         text        DEFAULT NULL
)
RETURNS TABLE (resultado text, persona_id uuid, mensaje text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
#variable_conflict use_column
DECLARE
    v_link          campana.links_referido%ROWTYPE;
    v_persona_id    uuid;
    v_autorizacion  uuid;
BEGIN
    IF NOT ('ORGANIZACION_CAMPANA' = ANY (p_finalidades)) THEN
        RAISE EXCEPTION 'Sin autorización para ORGANIZACION_CAMPANA no se puede registrar a la persona';
    END IF;

    SELECT l.* INTO v_link
      FROM campana.links_referido l
      JOIN campana.miembros m ON m.id = l.miembro_id
     WHERE l.codigo = upper(p_codigo_link)
       AND l.activo AND m.activo
       AND (l.expira_en IS NULL OR l.expira_en > now());

    IF NOT FOUND THEN
        RETURN QUERY SELECT 'LINK_INVALIDO', NULL::uuid, 'El link de referido no existe o está inactivo';
        RETURN;
    END IF;

    SELECT p.id INTO v_persona_id
      FROM personas.personas p
     WHERE p.tipo_documento_codigo = p_tipo_documento AND p.documento_hash = p_documento_hash;

    IF v_persona_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM campana.simpatizantes s WHERE s.persona_id = v_persona_id) THEN
        INSERT INTO calidad.intentos_duplicado (persona_existente_id, link_referido_id, canal_codigo)
        VALUES (v_persona_id, v_link.id, p_canal);
        RETURN QUERY SELECT 'DUPLICADO', NULL::uuid, 'Esta persona ya está registrada en la campaña';
        RETURN;
    END IF;

    -- La persona puede existir ya como miembro o usuario; si no, se crea.
    IF v_persona_id IS NULL THEN
        INSERT INTO personas.personas (tipo_documento_codigo, documento_hash, documento_cifrado, nombres, apellidos)
        VALUES (p_tipo_documento, p_documento_hash, p_documento_cifrado, p_nombres, p_apellidos)
        RETURNING id INTO v_persona_id;
    END IF;

    IF p_telefono_hash IS NOT NULL THEN
        INSERT INTO personas.telefonos (persona_id, telefono_hash, telefono_cifrado, es_principal)
        VALUES (v_persona_id, p_telefono_hash, p_telefono_cifrado,
                NOT EXISTS (SELECT 1 FROM personas.telefonos t WHERE t.persona_id = v_persona_id AND t.es_principal))
        ON CONFLICT (persona_id, telefono_hash) DO NOTHING;
    END IF;

    INSERT INTO cumplimiento.autorizaciones (persona_id, politica_version, canal_codigo, evidencia, ip, user_agent)
    VALUES (v_persona_id, p_politica_version, p_canal, p_evidencia, p_ip, p_user_agent)
    RETURNING id INTO v_autorizacion;

    INSERT INTO cumplimiento.autorizacion_finalidades (autorizacion_id, finalidad_codigo)
    SELECT v_autorizacion, f FROM unnest(p_finalidades) AS f;

    INSERT INTO campana.simpatizantes (persona_id, territorio_residencia_id, ubicacion, link_referido_id,
                                       canal_codigo, registrado_por, capturado_en)
    VALUES (v_persona_id, p_territorio_id,
            CASE WHEN p_lon IS NOT NULL THEN ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326) END,
            v_link.id, p_canal, acceso.usuario_actual(), p_capturado_en);

    IF p_puesto_id IS NOT NULL THEN
        INSERT INTO campana.simpatizante_puesto (persona_id, jornada_id, puesto_id)
        VALUES (v_persona_id, p_jornada_id, p_puesto_id);
    END IF;

    IF p_necesidad IS NOT NULL AND btrim(p_necesidad) <> '' THEN
        INSERT INTO participacion.necesidades (persona_id, territorio_id, descripcion, categoria_codigo)
        VALUES (v_persona_id, p_territorio_id, p_necesidad, p_categoria);
    END IF;

    RETURN QUERY SELECT 'REGISTRADO', v_persona_id, 'Registro exitoso';
END $$;

-- Retiro voluntario o administrativo (conserva el historial).
CREATE FUNCTION campana.retirar_simpatizante(p_persona_id uuid) RETURNS void
LANGUAGE sql AS $$
    UPDATE campana.simpatizantes SET estado_codigo = 'RETIRADO' WHERE persona_id = p_persona_id;
$$;


-- =============================================================================
-- 6. CUMPLIMIENTO – FESTIVOS Y DÍAS HÁBILES EN COLOMBIA
-- =============================================================================

-- Domingo de Pascua (algoritmo gregoriano anónimo).
CREATE FUNCTION cumplimiento.pascua(p_anio integer) RETURNS date
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    a int := p_anio % 19;
    b int := p_anio / 100;
    c int := p_anio % 100;
    d int := b / 4;
    e int := b % 4;
    f int := (b + 8) / 25;
    g int := (b - f + 1) / 3;
    h int := (19 * a + b - d - g + 15) % 30;
    i int := c / 4;
    k int := c % 4;
    l int := (32 + 2 * e + 2 * i - h - k) % 7;
    m int := (a + 11 * h + 22 * l) / 451;
    v_mes int := (h + l - 7 * m + 114) / 31;
    v_dia int := ((h + l - 7 * m + 114) % 31) + 1;
BEGIN
    RETURN make_date(p_anio, v_mes, v_dia);
END $$;

-- Ley 51 de 1983 (Ley Emiliani): algunos festivos se trasladan al lunes siguiente.
CREATE FUNCTION cumplimiento.al_lunes(p_fecha date) RETURNS date
LANGUAGE sql IMMUTABLE AS $$
    SELECT p_fecha + ((8 - extract(isodow FROM p_fecha)::int) % 7);
$$;

CREATE FUNCTION cumplimiento.festivos(p_anio integer)
RETURNS TABLE (fecha date, nombre text)
LANGUAGE sql IMMUTABLE AS $$
    WITH p AS (SELECT cumplimiento.pascua(p_anio) AS pascua)
    SELECT * FROM (VALUES
        (make_date(p_anio, 1, 1),                               'Año Nuevo'),
        (cumplimiento.al_lunes(make_date(p_anio, 1, 6)),        'Reyes Magos'),
        (cumplimiento.al_lunes(make_date(p_anio, 3, 19)),       'San José'),
        ((SELECT pascua FROM p) - 3,                            'Jueves Santo'),
        ((SELECT pascua FROM p) - 2,                            'Viernes Santo'),
        (make_date(p_anio, 5, 1),                               'Día del Trabajo'),
        (cumplimiento.al_lunes((SELECT pascua FROM p) + 39),    'Ascensión del Señor'),
        (cumplimiento.al_lunes((SELECT pascua FROM p) + 60),    'Corpus Christi'),
        (cumplimiento.al_lunes((SELECT pascua FROM p) + 68),    'Sagrado Corazón'),
        (cumplimiento.al_lunes(make_date(p_anio, 6, 29)),       'San Pedro y San Pablo'),
        (make_date(p_anio, 7, 20),                              'Independencia'),
        (make_date(p_anio, 8, 7),                               'Batalla de Boyacá'),
        (cumplimiento.al_lunes(make_date(p_anio, 8, 15)),       'Asunción de la Virgen'),
        (cumplimiento.al_lunes(make_date(p_anio, 10, 12)),      'Día de la Raza'),
        (cumplimiento.al_lunes(make_date(p_anio, 11, 1)),       'Todos los Santos'),
        (cumplimiento.al_lunes(make_date(p_anio, 11, 11)),      'Independencia de Cartagena'),
        (make_date(p_anio, 12, 8),                              'Inmaculada Concepción'),
        (make_date(p_anio, 12, 25),                             'Navidad')
    ) AS f(fecha, nombre);
$$;

CREATE FUNCTION cumplimiento.es_dia_habil(p_fecha date) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
    SELECT extract(isodow FROM p_fecha) < 6
       AND NOT EXISTS (SELECT 1 FROM cumplimiento.festivos(extract(year FROM p_fecha)::int) f
                        WHERE f.fecha = p_fecha);
$$;

-- Fecha que resulta de sumar N días hábiles (el día de radicación no cuenta).
CREATE FUNCTION cumplimiento.sumar_dias_habiles(p_desde date, p_dias integer) RETURNS date
LANGUAGE sql IMMUTABLE AS $$
    SELECT d::date
      FROM generate_series(p_desde + 1, p_desde + (p_dias * 3 + 15), interval '1 day') d
     WHERE cumplimiento.es_dia_habil(d::date)
     ORDER BY d
    OFFSET p_dias - 1 LIMIT 1;
$$;

-- Revoca todas las autorizaciones vigentes de una persona (el trigger la retira).
CREATE FUNCTION cumplimiento.revocar_autorizaciones(p_persona_id uuid) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
    v_filas integer;
BEGIN
    UPDATE cumplimiento.autorizaciones
       SET revocada_en = now()
     WHERE persona_id = p_persona_id AND revocada_en IS NULL;
    GET DIAGNOSTICS v_filas = ROW_COUNT;
    RETURN v_filas;
END $$;

-- Atiende una solicitud de SUPRESIÓN: borra a la persona y todos sus datos
-- (las necesidades quedan anónimas) y cierra la solicitud.
CREATE PROCEDURE cumplimiento.suprimir_persona(p_solicitud_id uuid, p_respuesta text)
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
        RAISE EXCEPTION 'La solicitud no está asociada a una persona';
    END IF;
    IF EXISTS (SELECT 1 FROM acceso.usuarios  WHERE persona_id = v_solicitud.persona_id)
    OR EXISTS (SELECT 1 FROM campana.miembros WHERE persona_id = v_solicitud.persona_id) THEN
        RAISE EXCEPTION 'La persona es usuario o miembro de la campaña: primero retírela de la estructura';
    END IF;

    UPDATE cumplimiento.solicitudes_titular
       SET estado = 'RESPONDIDA', respondida_en = now(), respuesta = p_respuesta
     WHERE id = p_solicitud_id;

    DELETE FROM personas.personas WHERE id = v_solicitud.persona_id;
END $$;


-- =============================================================================
-- 7. CALIDAD
-- =============================================================================

CREATE FUNCTION calidad.crear_alerta(
    p_tipo        text,
    p_personas    uuid[] DEFAULT '{}',
    p_miembros    uuid[] DEFAULT '{}',
    p_observacion text   DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
    v_id uuid;
BEGIN
    INSERT INTO calidad.alertas (tipo_codigo, observacion)
    VALUES (p_tipo, p_observacion) RETURNING id INTO v_id;

    INSERT INTO calidad.alerta_personas (alerta_id, persona_id)
    SELECT DISTINCT v_id, x FROM unnest(p_personas) x WHERE x IS NOT NULL;

    INSERT INTO calidad.alerta_miembros (alerta_id, miembro_id)
    SELECT DISTINCT v_id, x FROM unnest(p_miembros) x WHERE x IS NOT NULL;

    RETURN v_id;
END $$;

CREATE FUNCTION calidad.resolver_alerta(p_alerta_id uuid, p_estado text, p_observacion text)
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    IF p_estado NOT IN ('RESUELTA', 'DESCARTADA') THEN
        RAISE EXCEPTION 'Estado de cierre inválido: %', p_estado;
    END IF;
    UPDATE calidad.alertas
       SET estado = p_estado,
           observacion = coalesce(p_observacion, observacion)
     WHERE id = p_alerta_id;
END $$;


-- =============================================================================
-- 8. COMUNICACIONES
-- =============================================================================

-- Llena los destinatarios de un envío con los simpatizantes activos de los
-- territorios elegidos. Los que no autorizaron quedan como OMITIDO (trigger).
CREATE FUNCTION comunicaciones.generar_destinatarios(p_envio_id uuid) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
    v_filas integer;
BEGIN
    INSERT INTO comunicaciones.envio_destinatarios (envio_id, persona_id)
    SELECT DISTINCT p_envio_id, s.persona_id
      FROM comunicaciones.envio_territorios et
     CROSS JOIN LATERAL territorio.descendientes(et.territorio_id) d
      JOIN campana.simpatizantes s
        ON s.territorio_residencia_id = d.territorio_id AND s.estado_codigo = 'ACTIVO'
     WHERE et.envio_id = p_envio_id
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_filas = ROW_COUNT;
    RETURN v_filas;
END $$;


-- =============================================================================
-- 9. AUDITORÍA DESDE LA API
-- =============================================================================

-- Consultas de datos sensibles (ej. ver una cédula descifrada).
CREATE FUNCTION auditoria.registrar_consulta(p_esquema text, p_tabla text, p_registro_id text)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
    INSERT INTO auditoria.eventos (usuario_id, accion, esquema, tabla, registro_id, ip)
    VALUES (acceso.usuario_actual(), 'CONSULTA', p_esquema, p_tabla, p_registro_id, inet_client_addr());
$$;

CREATE FUNCTION auditoria.registrar_exportacion(
    p_motivo       text,
    p_formato      text,
    p_cantidad     integer,
    p_territorios  integer[]
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
    v_id bigint;
BEGIN
    IF acceso.usuario_actual() IS NULL THEN
        RAISE EXCEPTION 'No hay usuario en la sesión (app.usuario_id)';
    END IF;
    INSERT INTO auditoria.exportaciones (usuario_id, motivo, formato, cantidad_registros)
    VALUES (acceso.usuario_actual(), p_motivo, p_formato, p_cantidad)
    RETURNING id INTO v_id;

    INSERT INTO auditoria.exportacion_territorios (exportacion_id, territorio_id)
    SELECT DISTINCT v_id, t FROM unnest(p_territorios) t;

    INSERT INTO auditoria.eventos (usuario_id, accion, esquema, tabla, registro_id, ip)
    VALUES (acceso.usuario_actual(), 'EXPORTACION', 'auditoria', 'exportaciones', v_id::text, inet_client_addr());
    RETURN v_id;
END $$;


-- =============================================================================
-- 10. MANTENIMIENTO (para programar con pg_cron o una tarea de la API)
-- =============================================================================

CREATE FUNCTION chatbot.purgar_mensajes() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
    v_filas integer;
BEGIN
    DELETE FROM chatbot.mensajes
     WHERE enviado_en < now() - make_interval(days => campana.parametro_int('CHATBOT_RETENCION_DIAS'));
    GET DIAGNOSTICS v_filas = ROW_COUNT;
    RETURN v_filas;
END $$;

-- Refresca los conteos del mapa (la vista materializada se crea en 04_vistas.sql).
CREATE FUNCTION campana.refrescar_conteos() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY campana.mv_conteo_territorio;
END $$;
