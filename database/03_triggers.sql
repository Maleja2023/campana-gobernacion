-- =============================================================================
--  03_triggers.sql
--  Disparadores (triggers) con las reglas de negocio.
--  Los de integridad básica (jerarquía territorial, auditoría, bitácora
--  inmutable, finalidades) ya están en 01_esquema.sql.
--  Requiere: 01_esquema.sql y 02_funciones.sql
--
--  Las funciones de los triggers son SECURITY DEFINER: validan contra tablas
--  protegidas por RLS y deben ver todos los datos, no solo los del usuario.
-- =============================================================================


-- =============================================================================
-- 1. NORMALIZACIÓN DE TEXTOS
-- Nombres siempre en mayúsculas y sin espacios de sobra: evita que
-- "el porvenir" y "EL  PORVENIR" se guarden como dos barrios distintos.
-- =============================================================================

CREATE FUNCTION personas.fn_normalizar_persona() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
    NEW.nombres   := util.normalizar_nombre(NEW.nombres);
    NEW.apellidos := util.normalizar_nombre(NEW.apellidos);
    RETURN NEW;
END $$;

CREATE TRIGGER trg_personas_normalizar
BEFORE INSERT OR UPDATE OF nombres, apellidos ON personas.personas
FOR EACH ROW EXECUTE FUNCTION personas.fn_normalizar_persona();

CREATE FUNCTION territorio.fn_normalizar_nombre() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
    NEW.nombre := util.normalizar_nombre(NEW.nombre);
    RETURN NEW;
END $$;

CREATE TRIGGER trg_territorios_normalizar
BEFORE INSERT OR UPDATE OF nombre ON territorio.territorios
FOR EACH ROW EXECUTE FUNCTION territorio.fn_normalizar_nombre();

CREATE TRIGGER trg_nombres_alternos_normalizar
BEFORE INSERT OR UPDATE OF nombre ON territorio.nombres_alternos
FOR EACH ROW EXECUTE FUNCTION territorio.fn_normalizar_nombre();

CREATE TRIGGER trg_puestos_normalizar
BEFORE INSERT OR UPDATE OF nombre ON electoral.puestos_votacion
FOR EACH ROW EXECUTE FUNCTION territorio.fn_normalizar_nombre();

CREATE TRIGGER trg_propuestas_fecha
BEFORE UPDATE ON participacion.propuestas
FOR EACH ROW EXECUTE FUNCTION util.fn_actualizar_fecha();


-- =============================================================================
-- 2. ESTRUCTURA DE CAMPAÑA
-- =============================================================================

-- El superior debe estar activo, tener un cargo de nivel más alto, y no puede
-- haber ciclos (A jefe de B y B jefe de A).
CREATE FUNCTION campana.fn_validar_miembro() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
    v_nivel_propio   smallint;
    v_nivel_superior smallint;
    v_superior_activo boolean;
BEGIN
    IF NEW.superior_id IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT nivel INTO v_nivel_propio FROM campana.cargos WHERE codigo = NEW.cargo_codigo;
    SELECT c.nivel, m.activo INTO v_nivel_superior, v_superior_activo
      FROM campana.miembros m JOIN campana.cargos c ON c.codigo = m.cargo_codigo
     WHERE m.id = NEW.superior_id;

    IF NOT v_superior_activo THEN
        RAISE EXCEPTION 'El superior asignado está inactivo';
    END IF;
    IF v_nivel_superior >= v_nivel_propio THEN
        RAISE EXCEPTION 'Un % no puede depender de alguien con cargo de igual o menor nivel', NEW.cargo_codigo;
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.superior_id IN (SELECT miembro_id FROM campana.subordinados(NEW.id)) THEN
        RAISE EXCEPTION 'Asignación circular: el superior es subordinado de este miembro';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_miembros_validar
BEFORE INSERT OR UPDATE OF superior_id, cargo_codigo ON campana.miembros
FOR EACH ROW EXECUTE FUNCTION campana.fn_validar_miembro();

-- Todo miembro nuevo recibe automáticamente su link principal.
CREATE FUNCTION campana.fn_crear_link_principal() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
    PERFORM campana.crear_link(NEW.id, true);
    RETURN NULL;
END $$;

CREATE TRIGGER trg_miembros_link_principal
AFTER INSERT ON campana.miembros
FOR EACH ROW EXECUTE FUNCTION campana.fn_crear_link_principal();

-- Si un miembro se desactiva, sus links dejan de funcionar.
CREATE FUNCTION campana.fn_desactivar_links() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
    UPDATE campana.links_referido SET activo = false WHERE miembro_id = NEW.id AND activo;
    RETURN NULL;
END $$;

CREATE TRIGGER trg_miembros_desactivar_links
AFTER UPDATE OF activo ON campana.miembros
FOR EACH ROW WHEN (OLD.activo AND NOT NEW.activo)
EXECUTE FUNCTION campana.fn_desactivar_links();


-- =============================================================================
-- 3. SIMPATIZANTES
-- =============================================================================

-- El link debe estar activo, vigente y ser de un miembro activo.
CREATE FUNCTION campana.fn_validar_link_simpatizante() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM campana.links_referido l
          JOIN campana.miembros m ON m.id = l.miembro_id
         WHERE l.id = NEW.link_referido_id AND l.activo AND m.activo
           AND (l.expira_en IS NULL OR l.expira_en > now())
    ) THEN
        RAISE EXCEPTION 'El link de referido está inactivo o vencido';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_simpatizantes_link
BEFORE INSERT OR UPDATE OF link_referido_id ON campana.simpatizantes
FOR EACH ROW EXECUTE FUNCTION campana.fn_validar_link_simpatizante();

-- Ley 1581: nadie queda registrado sin autorización vigente para la campaña.
-- Es un trigger DIFERIDO: se revisa al final de la transacción, cuando la
-- autorización ya fue insertada.
CREATE FUNCTION campana.fn_exigir_autorizacion() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM cumplimiento.autorizaciones a
          JOIN cumplimiento.autorizacion_finalidades af ON af.autorizacion_id = a.id
         WHERE a.persona_id = NEW.persona_id
           AND a.revocada_en IS NULL
           AND af.finalidad_codigo = 'ORGANIZACION_CAMPANA'
    ) THEN
        RAISE EXCEPTION 'La persona % no tiene autorización vigente de tratamiento de datos', NEW.persona_id;
    END IF;
    RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER trg_simpatizantes_autorizacion
AFTER INSERT ON campana.simpatizantes
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION campana.fn_exigir_autorizacion();

-- Registro masivo: muchos registros del mismo link en pocos minutos.
CREATE FUNCTION calidad.fn_detectar_registro_masivo() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
    v_miembro  uuid;
    v_cantidad integer;
BEGIN
    SELECT count(*) INTO v_cantidad
      FROM campana.simpatizantes
     WHERE link_referido_id = NEW.link_referido_id
       AND recibido_en > now() - make_interval(mins => campana.parametro_int('REGISTRO_MASIVO_MINUTOS'));

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
                    format('%s registros en %s minutos', v_cantidad,
                           campana.parametro_int('REGISTRO_MASIVO_MINUTOS')));
        END IF;
    END IF;
    RETURN NULL;
END $$;

CREATE TRIGGER trg_simpatizantes_registro_masivo
AFTER INSERT ON campana.simpatizantes
FOR EACH ROW EXECUTE FUNCTION calidad.fn_detectar_registro_masivo();

-- Ubicación GPS que no cae dentro del territorio declarado.
CREATE FUNCTION calidad.fn_detectar_ubicacion_inconsistente() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
    v_geom     geometry;
    v_miembro  uuid;
BEGIN
    IF NEW.ubicacion IS NULL THEN
        RETURN NULL;
    END IF;
    -- se compara contra el municipio, que siempre tiene polígono
    SELECT geom INTO v_geom FROM territorio.territorios
     WHERE id = territorio.ancestro(NEW.territorio_residencia_id, 'MUNICIPIO');

    IF v_geom IS NOT NULL AND NOT ST_Intersects(v_geom, NEW.ubicacion) THEN
        SELECT miembro_id INTO v_miembro FROM campana.links_referido WHERE id = NEW.link_referido_id;
        PERFORM calidad.crear_alerta('UBICACION_INCONSISTENTE', ARRAY[NEW.persona_id], ARRAY[v_miembro],
                'La ubicación GPS está fuera del municipio declarado');
    END IF;
    RETURN NULL;
END $$;

CREATE TRIGGER trg_simpatizantes_ubicacion
AFTER INSERT OR UPDATE OF ubicacion, territorio_residencia_id ON campana.simpatizantes
FOR EACH ROW EXECUTE FUNCTION calidad.fn_detectar_ubicacion_inconsistente();

-- Mismo teléfono en varias personas.
CREATE FUNCTION calidad.fn_detectar_telefono_repetido() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
    v_personas uuid[];
BEGIN
    SELECT array_agg(DISTINCT persona_id) INTO v_personas
      FROM personas.telefonos WHERE telefono_hash = NEW.telefono_hash;

    IF cardinality(v_personas) > 1 THEN
        -- si ya hay una alerta abierta con alguna de esas personas, se agrega a ella
        IF EXISTS (
            SELECT 1 FROM calidad.alertas a
              JOIN calidad.alerta_personas ap ON ap.alerta_id = a.id
             WHERE a.tipo_codigo = 'TELEFONO_REPETIDO' AND a.estado IN ('ABIERTA','EN_REVISION')
               AND ap.persona_id = ANY (v_personas)
        ) THEN
            INSERT INTO calidad.alerta_personas (alerta_id, persona_id)
            SELECT a.id, NEW.persona_id
              FROM calidad.alertas a
              JOIN calidad.alerta_personas ap ON ap.alerta_id = a.id
             WHERE a.tipo_codigo = 'TELEFONO_REPETIDO' AND a.estado IN ('ABIERTA','EN_REVISION')
               AND ap.persona_id = ANY (v_personas)
             LIMIT 1
            ON CONFLICT DO NOTHING;
        ELSE
            PERFORM calidad.crear_alerta('TELEFONO_REPETIDO', v_personas, '{}',
                    'El mismo teléfono aparece en varias personas');
        END IF;
    END IF;
    RETURN NULL;
END $$;

CREATE TRIGGER trg_telefonos_repetidos
AFTER INSERT ON personas.telefonos
FOR EACH ROW EXECUTE FUNCTION calidad.fn_detectar_telefono_repetido();

-- Intento de duplicado: alerta con la persona, el líder que la registró
-- primero y el líder que intentó registrarla de nuevo.
CREATE FUNCTION calidad.fn_alerta_duplicado() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
    v_miembro_original uuid;
    v_miembro_intento  uuid;
    v_alerta           uuid;
BEGIN
    SELECT l.miembro_id INTO v_miembro_original
      FROM campana.simpatizantes s JOIN campana.links_referido l ON l.id = s.link_referido_id
     WHERE s.persona_id = NEW.persona_existente_id;
    SELECT miembro_id INTO v_miembro_intento FROM campana.links_referido WHERE id = NEW.link_referido_id;

    IF v_miembro_original = v_miembro_intento THEN
        RETURN NULL;   -- el mismo líder repitió el registro: no es conflicto
    END IF;

    SELECT a.id INTO v_alerta
      FROM calidad.alertas a JOIN calidad.alerta_personas ap ON ap.alerta_id = a.id
     WHERE a.tipo_codigo = 'DUPLICADO_ENTRE_LIDERES' AND a.estado IN ('ABIERTA','EN_REVISION')
       AND ap.persona_id = NEW.persona_existente_id
     LIMIT 1;

    IF v_alerta IS NULL THEN
        PERFORM calidad.crear_alerta('DUPLICADO_ENTRE_LIDERES', ARRAY[NEW.persona_existente_id],
                ARRAY[v_miembro_original, v_miembro_intento], NULL);
    ELSE
        INSERT INTO calidad.alerta_miembros (alerta_id, miembro_id)
        VALUES (v_alerta, v_miembro_intento) ON CONFLICT DO NOTHING;
    END IF;
    RETURN NULL;
END $$;

CREATE TRIGGER trg_intentos_duplicado_alerta
AFTER INSERT ON calidad.intentos_duplicado
FOR EACH ROW EXECUTE FUNCTION calidad.fn_alerta_duplicado();


-- =============================================================================
-- 4. CUMPLIMIENTO
-- =============================================================================

-- Si se revoca la última autorización vigente para la campaña, la persona
-- queda RETIRADA automáticamente.
CREATE FUNCTION cumplimiento.fn_retirar_si_revoca() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM cumplimiento.autorizaciones a
          JOIN cumplimiento.autorizacion_finalidades af ON af.autorizacion_id = a.id
         WHERE a.persona_id = NEW.persona_id AND a.revocada_en IS NULL
           AND af.finalidad_codigo = 'ORGANIZACION_CAMPANA'
    ) THEN
        UPDATE campana.simpatizantes SET estado_codigo = 'RETIRADO'
         WHERE persona_id = NEW.persona_id AND estado_codigo <> 'RETIRADO';
    END IF;
    RETURN NULL;
END $$;

CREATE TRIGGER trg_autorizaciones_revocar
AFTER UPDATE OF revocada_en ON cumplimiento.autorizaciones
FOR EACH ROW WHEN (OLD.revocada_en IS NULL AND NEW.revocada_en IS NOT NULL)
EXECUTE FUNCTION cumplimiento.fn_retirar_si_revoca();

-- Al cerrar una solicitud, la fecha de respuesta se pone sola.
CREATE FUNCTION cumplimiento.fn_fecha_respuesta() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
    IF NEW.estado IN ('RESPONDIDA','RECHAZADA') AND NEW.respondida_en IS NULL THEN
        NEW.respondida_en := now();
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_solicitudes_fecha_respuesta
BEFORE UPDATE OF estado ON cumplimiento.solicitudes_titular
FOR EACH ROW EXECUTE FUNCTION cumplimiento.fn_fecha_respuesta();

-- Una necesidad sin territorio toma el de residencia del simpatizante.
CREATE FUNCTION participacion.fn_territorio_necesidad() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
    IF NEW.territorio_id IS NULL AND NEW.persona_id IS NOT NULL THEN
        SELECT territorio_residencia_id INTO NEW.territorio_id
          FROM campana.simpatizantes WHERE persona_id = NEW.persona_id;
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_necesidades_territorio
BEFORE INSERT ON participacion.necesidades
FOR EACH ROW EXECUTE FUNCTION participacion.fn_territorio_necesidad();


-- =============================================================================
-- 5. CALIDAD: CIERRE DE ALERTAS
-- =============================================================================

CREATE FUNCTION calidad.fn_cerrar_alerta() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
    IF NEW.estado IN ('RESUELTA','DESCARTADA') AND OLD.estado NOT IN ('RESUELTA','DESCARTADA') THEN
        NEW.resuelta_en  := coalesce(NEW.resuelta_en, now());
        NEW.resuelta_por := coalesce(NEW.resuelta_por, acceso.usuario_actual());
        IF NEW.resuelta_por IS NULL THEN
            RAISE EXCEPTION 'Para cerrar una alerta debe haber un usuario en la sesión';
        END IF;
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_alertas_cierre
BEFORE UPDATE OF estado ON calidad.alertas
FOR EACH ROW EXECUTE FUNCTION calidad.fn_cerrar_alerta();


-- =============================================================================
-- 6. EVENTOS
-- =============================================================================

-- El check-in por QR solo se acepta cerca del horario del evento.
CREATE FUNCTION eventos.fn_validar_asistencia() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
    v_margen interval := make_interval(mins => campana.parametro_int('CHECKIN_MARGEN_MINUTOS'));
BEGIN
    IF NEW.metodo = 'QR' AND NOT EXISTS (
        SELECT 1 FROM eventos.eventos e
         WHERE e.id = NEW.evento_id
           AND NEW.registrada_en BETWEEN e.inicia_en - v_margen AND e.termina_en + v_margen
    ) THEN
        RAISE EXCEPTION 'El check-in QR está fuera del horario del evento';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_asistencias_validar
BEFORE INSERT ON eventos.asistencias
FOR EACH ROW EXECUTE FUNCTION eventos.fn_validar_asistencia();


-- =============================================================================
-- 7. COMUNICACIONES
-- =============================================================================

-- Si cambia el texto de una plantilla aprobada, pierde la aprobación.
CREATE FUNCTION comunicaciones.fn_reaprobar_plantilla() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
    IF NEW.contenido IS DISTINCT FROM OLD.contenido THEN
        NEW.aprobada_por := NULL;
        NEW.aprobada_en  := NULL;
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_plantillas_reaprobar
BEFORE UPDATE OF contenido ON comunicaciones.plantillas
FOR EACH ROW EXECUTE FUNCTION comunicaciones.fn_reaprobar_plantilla();

-- No se programa un envío con una plantilla sin aprobar.
CREATE FUNCTION comunicaciones.fn_validar_envio() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
    IF NEW.estado IN ('PROGRAMADO','EN_CURSO') AND EXISTS (
        SELECT 1 FROM comunicaciones.plantillas WHERE id = NEW.plantilla_id AND aprobada_en IS NULL
    ) THEN
        RAISE EXCEPTION 'La plantilla del envío no está aprobada';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_envios_validar
BEFORE INSERT OR UPDATE OF estado ON comunicaciones.envios
FOR EACH ROW EXECUTE FUNCTION comunicaciones.fn_validar_envio();

-- Quien no autorizó comunicaciones, o pidió la baja en ese canal, queda OMITIDO.
CREATE FUNCTION comunicaciones.fn_filtrar_destinatario() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
    v_canal text;
BEGIN
    SELECT p.canal_codigo INTO v_canal
      FROM comunicaciones.envios e JOIN comunicaciones.plantillas p ON p.id = e.plantilla_id
     WHERE e.id = NEW.envio_id;

    IF NOT EXISTS (
        SELECT 1 FROM cumplimiento.autorizaciones a
          JOIN cumplimiento.autorizacion_finalidades af
            ON af.autorizacion_id = a.id AND af.finalidad_codigo = 'COMUNICACIONES'
         WHERE a.persona_id = NEW.persona_id AND a.revocada_en IS NULL
    ) OR EXISTS (
        SELECT 1 FROM comunicaciones.bajas b WHERE b.persona_id = NEW.persona_id AND b.canal_codigo = v_canal
    ) THEN
        NEW.estado := 'OMITIDO_SIN_AUTORIZACION';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_destinatarios_filtrar
BEFORE INSERT ON comunicaciones.envio_destinatarios
FOR EACH ROW EXECUTE FUNCTION comunicaciones.fn_filtrar_destinatario();


-- =============================================================================
-- 8. DÍA D
-- =============================================================================

-- Un testigo cubre mesas de un solo puesto por jornada.
CREATE FUNCTION electoral.fn_validar_testigo() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM electoral.testigos t
          JOIN electoral.mesas otra ON otra.id = t.mesa_id
          JOIN electoral.mesas esta ON esta.id = NEW.mesa_id
         WHERE t.miembro_id = NEW.miembro_id
           AND otra.jornada_id = esta.jornada_id
           AND otra.puesto_id <> esta.puesto_id
    ) THEN
        RAISE EXCEPTION 'Este testigo ya está asignado a otro puesto en la misma jornada';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_testigos_validar
BEFORE INSERT OR UPDATE ON electoral.testigos
FOR EACH ROW EXECUTE FUNCTION electoral.fn_validar_testigo();

-- Los votos de un E-14 deben ser de opciones de la misma jornada y corporación.
CREATE FUNCTION electoral.fn_validar_resultado() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM electoral.formularios_e14 f
          JOIN electoral.mesas m        ON m.id = f.mesa_id
          JOIN electoral.opciones_voto o ON o.id = NEW.opcion_voto_id
         WHERE f.id = NEW.formulario_id
           AND o.jornada_id = m.jornada_id
           AND o.corporacion_codigo = f.corporacion_codigo
    ) THEN
        RAISE EXCEPTION 'La opción de voto no corresponde a la jornada o corporación del formulario';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_resultados_validar
BEFORE INSERT OR UPDATE ON electoral.resultados_e14
FOR EACH ROW EXECUTE FUNCTION electoral.fn_validar_resultado();


-- =============================================================================
-- 9. AUDITORÍA DE TABLAS ADICIONALES
-- =============================================================================

CREATE TRIGGER trg_audit_links AFTER INSERT OR UPDATE OR DELETE ON campana.links_referido
FOR EACH ROW EXECUTE FUNCTION auditoria.fn_registrar_cambio('id');
CREATE TRIGGER trg_audit_metas_miembro AFTER INSERT OR UPDATE OR DELETE ON campana.metas_miembro
FOR EACH ROW EXECUTE FUNCTION auditoria.fn_registrar_cambio('id');
CREATE TRIGGER trg_audit_metas_territorio AFTER INSERT OR UPDATE OR DELETE ON campana.metas_territorio
FOR EACH ROW EXECUTE FUNCTION auditoria.fn_registrar_cambio('id');
CREATE TRIGGER trg_audit_simpatizante_puesto AFTER INSERT OR UPDATE OR DELETE ON campana.simpatizante_puesto
FOR EACH ROW EXECUTE FUNCTION auditoria.fn_registrar_cambio('persona_id');
CREATE TRIGGER trg_audit_solicitudes AFTER INSERT OR UPDATE OR DELETE ON cumplimiento.solicitudes_titular
FOR EACH ROW EXECUTE FUNCTION auditoria.fn_registrar_cambio('id');
CREATE TRIGGER trg_audit_alertas AFTER INSERT OR UPDATE OR DELETE ON calidad.alertas
FOR EACH ROW EXECUTE FUNCTION auditoria.fn_registrar_cambio('id');
CREATE TRIGGER trg_audit_envios AFTER INSERT OR UPDATE OR DELETE ON comunicaciones.envios
FOR EACH ROW EXECUTE FUNCTION auditoria.fn_registrar_cambio('id');
CREATE TRIGGER trg_audit_e14 AFTER INSERT OR UPDATE OR DELETE ON electoral.formularios_e14
FOR EACH ROW EXECUTE FUNCTION auditoria.fn_registrar_cambio('id');
CREATE TRIGGER trg_audit_resultados AFTER INSERT OR UPDATE OR DELETE ON electoral.resultados_e14
FOR EACH ROW EXECUTE FUNCTION auditoria.fn_registrar_cambio('formulario_id');
CREATE TRIGGER trg_audit_usuarios AFTER INSERT OR UPDATE OR DELETE ON acceso.usuarios
FOR EACH ROW EXECUTE FUNCTION auditoria.fn_registrar_cambio('id');
CREATE TRIGGER trg_audit_puestos AFTER INSERT OR UPDATE OR DELETE ON electoral.puestos_votacion
FOR EACH ROW EXECUTE FUNCTION auditoria.fn_registrar_cambio('id');
