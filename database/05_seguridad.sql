-- =============================================================================
--  05_seguridad.sql
--  Roles de base de datos, permisos (GRANT) y seguridad por fila (RLS).
--  Requiere: 01 a 04
--
--  ROLES
--    rol_app       -> la API (NestJS). Lee y escribe, sujeta a RLS.
--    rol_reportes  -> herramientas de reportes/BI. Solo lectura, sujeta a RLS.
--  Son roles de grupo (sin login). Para crear el usuario real de la API:
--    CREATE ROLE api_campana LOGIN PASSWORD '<contraseña fuerte>' IN ROLE rol_app;
--  Nunca conecte la API con "postgres": el dueño de las tablas se salta RLS.
--
--  CÓMO FUNCIONA RLS AQUÍ
--  La API, al iniciar cada transacción, indica quién es el usuario:
--    SET LOCAL app.usuario_id = '<uuid del usuario>';
--  Sin ese dato, las tablas protegidas se ven vacías.
--    a) Gerente/candidato: se les asigna el territorio CAQUETÁ -> ven todo.
--    b) Coordinadores: se les asigna su municipio -> ven lo de su municipio.
--    c) Líderes: NO se les asigna territorio -> ven solo su red de referidos.
--  Un coordinador ve además toda su red, aunque un líder suyo trabaje en otro
--  municipio (las políticas se suman).
-- =============================================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rol_app') THEN
        CREATE ROLE rol_app NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rol_reportes') THEN
        CREATE ROLE rol_reportes NOLOGIN;
    END IF;
END $$;


-- =============================================================================
-- 1. PERMISOS SOBRE OBJETOS
-- =============================================================================

GRANT USAGE ON SCHEMA territorio, electoral, personas, acceso, campana, participacion,
      cumplimiento, calidad, eventos, comunicaciones, chatbot, auditoria, util
   TO rol_app, rol_reportes;

-- API: lectura y escritura en los módulos de negocio
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA
      territorio, electoral, personas, acceso, campana, participacion,
      cumplimiento, calidad, eventos, comunicaciones, chatbot
   TO rol_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA
      territorio, electoral, personas, acceso, campana, participacion,
      cumplimiento, calidad, eventos, comunicaciones, chatbot, auditoria
   TO rol_app;

-- La auditoría solo se lee; se escribe a través de triggers y funciones.
GRANT SELECT ON ALL TABLES IN SCHEMA auditoria TO rol_app;

-- Catálogos: la API no los modifica (se cambian con scripts de migración).
REVOKE INSERT, UPDATE, DELETE ON
      territorio.tipos_territorio, territorio.fuentes_geograficas,
      electoral.tipos_jornada, electoral.corporaciones,
      personas.tipos_documento, acceso.roles, acceso.permisos, acceso.rol_permisos,
      campana.cargos, campana.canales_registro, campana.estados_simpatizante,
      cumplimiento.finalidades, cumplimiento.tipos_solicitud, cumplimiento.politicas_tratamiento,
      cumplimiento.politica_finalidades, calidad.tipos_alerta, eventos.tipos_evento,
      comunicaciones.canales
   FROM rol_app;

-- Reportes: solo lectura (sin auditoría ni mensajes del chatbot)
GRANT SELECT ON ALL TABLES IN SCHEMA
      territorio, electoral, personas, acceso, campana, participacion,
      cumplimiento, calidad, eventos, comunicaciones
   TO rol_reportes;
REVOKE SELECT ON acceso.usuarios, acceso.factores_mfa, acceso.sesiones FROM rol_reportes;

-- Las funciones SECURITY DEFINER solo las ejecuta la API.
REVOKE EXECUTE ON FUNCTION
      campana.registrar_simpatizante(text, bytea, bytea, text, text, bytea, bytea, integer, text, text,
                                     smallint, text[], text, timestamptz, smallint, integer, text, text,
                                     double precision, double precision, inet, text),
      auditoria.registrar_consulta(text, text, text),
      auditoria.registrar_exportacion(text, text, integer, integer[]),
      campana.refrescar_conteos()
   FROM PUBLIC;
REVOKE EXECUTE ON PROCEDURE cumplimiento.suprimir_persona(uuid, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
      campana.registrar_simpatizante(text, bytea, bytea, text, text, bytea, bytea, integer, text, text,
                                     smallint, text[], text, timestamptz, smallint, integer, text, text,
                                     double precision, double precision, inet, text),
      auditoria.registrar_consulta(text, text, text),
      auditoria.registrar_exportacion(text, text, integer, integer[]),
      campana.refrescar_conteos()
   TO rol_app;
GRANT EXECUTE ON PROCEDURE cumplimiento.suprimir_persona(uuid, text) TO rol_app;


-- =============================================================================
-- 2. FUNCIONES AUXILIARES DE RLS
-- =============================================================================

CREATE FUNCTION acceso.territorios_visibles() RETURNS TABLE (territorio_id integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
    SELECT d.territorio_id
      FROM acceso.usuario_territorios ut
     CROSS JOIN LATERAL territorio.descendientes(ut.territorio_id) d
     WHERE ut.usuario_id = acceso.usuario_actual();
$$;

CREATE FUNCTION acceso.links_visibles() RETURNS TABLE (link_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
    SELECT l.id
      FROM acceso.usuarios u
      JOIN campana.miembros m ON m.persona_id = u.persona_id
     CROSS JOIN LATERAL campana.subordinados(m.id) s
      JOIN campana.links_referido l ON l.miembro_id = s.miembro_id
     WHERE u.id = acceso.usuario_actual();
$$;


-- =============================================================================
-- 3. POLÍTICAS
-- =============================================================================

-- Simpatizantes ---------------------------------------------------------------
ALTER TABLE campana.simpatizantes ENABLE ROW LEVEL SECURITY;

CREATE POLICY p_simpatizantes_por_territorio ON campana.simpatizantes
    USING (territorio_residencia_id IN (SELECT territorio_id FROM acceso.territorios_visibles()));

CREATE POLICY p_simpatizantes_por_red ON campana.simpatizantes
    USING (link_referido_id IN (SELECT link_id FROM acceso.links_visibles()));

-- Personas --------------------------------------------------------------------
-- Se ve a una persona si es un simpatizante visible (la subconsulta ya está
-- filtrada por RLS) o si hace parte del equipo de la campaña.
ALTER TABLE personas.personas ENABLE ROW LEVEL SECURITY;

CREATE POLICY p_personas_lectura ON personas.personas FOR SELECT
    USING (EXISTS (SELECT 1 FROM campana.simpatizantes s WHERE s.persona_id = personas.id)
        OR (acceso.usuario_actual() IS NOT NULL
            AND (EXISTS (SELECT 1 FROM campana.miembros m WHERE m.persona_id = personas.id)
              OR EXISTS (SELECT 1 FROM acceso.usuarios u  WHERE u.persona_id = personas.id))));

CREATE POLICY p_personas_edicion ON personas.personas FOR UPDATE
    USING (EXISTS (SELECT 1 FROM campana.simpatizantes s WHERE s.persona_id = personas.id));

CREATE POLICY p_personas_insercion ON personas.personas FOR INSERT
    WITH CHECK (acceso.usuario_actual() IS NOT NULL);
-- DELETE: no hay política; solo se borra con cumplimiento.suprimir_persona.

-- Datos de contacto: visibles si la persona es visible ----------------------------
ALTER TABLE personas.telefonos ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_telefonos_lectura ON personas.telefonos FOR SELECT
    USING (EXISTS (SELECT 1 FROM personas.personas p WHERE p.id = telefonos.persona_id));
CREATE POLICY p_telefonos_edicion ON personas.telefonos FOR UPDATE
    USING (EXISTS (SELECT 1 FROM personas.personas p WHERE p.id = telefonos.persona_id));
CREATE POLICY p_telefonos_borrado ON personas.telefonos FOR DELETE
    USING (EXISTS (SELECT 1 FROM personas.personas p WHERE p.id = telefonos.persona_id));
CREATE POLICY p_telefonos_insercion ON personas.telefonos FOR INSERT
    WITH CHECK (acceso.usuario_actual() IS NOT NULL);

ALTER TABLE personas.correos ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_correos_lectura ON personas.correos FOR SELECT
    USING (EXISTS (SELECT 1 FROM personas.personas p WHERE p.id = correos.persona_id));
CREATE POLICY p_correos_edicion ON personas.correos FOR UPDATE
    USING (EXISTS (SELECT 1 FROM personas.personas p WHERE p.id = correos.persona_id));
CREATE POLICY p_correos_borrado ON personas.correos FOR DELETE
    USING (EXISTS (SELECT 1 FROM personas.personas p WHERE p.id = correos.persona_id));
CREATE POLICY p_correos_insercion ON personas.correos FOR INSERT
    WITH CHECK (acceso.usuario_actual() IS NOT NULL);

-- Puesto de votación de cada simpatizante ------------------------------------
ALTER TABLE campana.simpatizante_puesto ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_simpatizante_puesto ON campana.simpatizante_puesto
    USING (EXISTS (SELECT 1 FROM campana.simpatizantes s WHERE s.persona_id = simpatizante_puesto.persona_id));

-- Autorizaciones --------------------------------------------------------------
ALTER TABLE cumplimiento.autorizaciones ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_autorizaciones_lectura ON cumplimiento.autorizaciones FOR SELECT
    USING (EXISTS (SELECT 1 FROM personas.personas p WHERE p.id = autorizaciones.persona_id));
CREATE POLICY p_autorizaciones_revocar ON cumplimiento.autorizaciones FOR UPDATE
    USING (EXISTS (SELECT 1 FROM personas.personas p WHERE p.id = autorizaciones.persona_id));
CREATE POLICY p_autorizaciones_insercion ON cumplimiento.autorizaciones FOR INSERT
    WITH CHECK (acceso.usuario_actual() IS NOT NULL);

-- Necesidades: por territorio o por red -----------------------------------------
ALTER TABLE participacion.necesidades ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_necesidades ON participacion.necesidades
    USING (territorio_id IN (SELECT territorio_id FROM acceso.territorios_visibles())
        OR EXISTS (SELECT 1 FROM campana.simpatizantes s WHERE s.persona_id = necesidades.persona_id));

-- Asistencias a eventos ---------------------------------------------------------
ALTER TABLE eventos.asistencias ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_asistencias ON eventos.asistencias
    USING (EXISTS (SELECT 1 FROM personas.personas p WHERE p.id = asistencias.persona_id));

-- Mensajes del chatbot: solo personal con acceso a todo el departamento ----------
ALTER TABLE chatbot.mensajes ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_mensajes_chatbot_insercion ON chatbot.mensajes FOR INSERT
    WITH CHECK (true);   -- el servicio del chatbot escribe sin usuario de sesión
CREATE POLICY p_mensajes_chatbot ON chatbot.mensajes FOR SELECT
    USING (EXISTS (SELECT 1 FROM acceso.territorios_visibles() tv
                     JOIN territorio.territorios t ON t.id = tv.territorio_id
                    WHERE t.tipo_codigo = 'DEPARTAMENTO'));

-- Vista materializada de conteos (sin datos personales)
GRANT SELECT ON campana.mv_conteo_territorio TO rol_app, rol_reportes;
