-- =============================================================================
--  33_enlace_lideres.sql
--  Dos enlaces por miembro:
--    - Enlace de VOTANTES (el que ya existía): quien se registra queda como
--      simpatizante referido por el miembro.
--    - Enlace de LÍDERES: el coordinador invita líderes y el líder invita
--      sublíderes. Quien se registra por él queda como simpatizante y además
--      responde preguntas de líder (zona de trabajo, cuántas personas puede
--      sumar, organización). Eso crea una SOLICITUD pendiente: solo entra a
--      la estructura cuando la aprueba quien lo invitó o alguien que gestiona
--      miembros sobre él. Así nadie se vuelve líder solo por tener el enlace.
--
--  Además, el saludo del formulario público muestra el nombre completo y el
--  cargo de quien invita ("Ana Pérez, líder de la campaña, te invita...").
--
--  Requiere: 01 a 32. Se puede ejecutar más de una vez.
-- =============================================================================

BEGIN;

ALTER TABLE campana.links_referido ADD COLUMN IF NOT EXISTS proposito text NOT NULL DEFAULT 'VOTANTE';
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_link_proposito') THEN
        ALTER TABLE campana.links_referido
            ADD CONSTRAINT ck_link_proposito CHECK (proposito IN ('VOTANTE', 'LIDER'));
    END IF;
END $$;
-- Un solo enlace de líderes activo por miembro.
CREATE UNIQUE INDEX IF NOT EXISTS uq_link_lideres ON campana.links_referido (miembro_id)
    WHERE proposito = 'LIDER' AND activo;

-- Cargo que obtiene quien entra por el enlace de líderes de un miembro.
CREATE OR REPLACE FUNCTION campana.cargo_invitado(p_cargo text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE p_cargo WHEN 'COORDINADOR' THEN 'LIDER' WHEN 'LIDER' THEN 'SUBLIDER' END;
$$;

-- Enlace de líderes del usuario de la sesión (se crea la primera vez).
CREATE OR REPLACE FUNCTION campana.mi_enlace_lideres()
RETURNS TABLE (codigo text, cargo_invitado text, solicitudes_pendientes integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
#variable_conflict use_column
DECLARE
    v_miembro campana.miembros%ROWTYPE;
    v_codigo  text;
BEGIN
    SELECT m.* INTO v_miembro
      FROM acceso.usuarios u JOIN campana.miembros m ON m.persona_id = u.persona_id
     WHERE u.id = acceso.usuario_actual() AND m.activo;
    IF NOT FOUND OR campana.cargo_invitado(v_miembro.cargo_codigo) IS NULL THEN
        RETURN;   -- sin miembro, o sublíder/gerente: no invita líderes por enlace
    END IF;

    SELECT l.codigo INTO v_codigo FROM campana.links_referido l
     WHERE l.miembro_id = v_miembro.id AND l.proposito = 'LIDER' AND l.activo;
    IF v_codigo IS NULL THEN
        v_codigo := campana.crear_link(v_miembro.id, false);
        UPDATE campana.links_referido SET proposito = 'LIDER' WHERE links_referido.codigo = v_codigo;
    END IF;

    RETURN QUERY
        SELECT v_codigo, campana.cargo_invitado(v_miembro.cargo_codigo),
               (SELECT count(*)::integer FROM campana.solicitudes_lider s
                 WHERE s.miembro_invita_id = v_miembro.id AND s.estado = 'PENDIENTE');
END $$;

-- Lo que el formulario público necesita del enlace (visitante anónimo).
CREATE OR REPLACE FUNCTION campana.info_link_publico(p_codigo text)
RETURNS TABLE (nombre text, cargo text, proposito text, cargo_invitado text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
    SELECT btrim(p.nombres) || ' ' || btrim(p.apellidos), m.cargo_codigo, l.proposito,
           CASE WHEN l.proposito = 'LIDER' THEN campana.cargo_invitado(m.cargo_codigo) END
      FROM campana.links_referido l
      JOIN campana.miembros m  ON m.id = l.miembro_id
      JOIN personas.personas p ON p.id = m.persona_id
     WHERE l.codigo = upper(btrim(p_codigo))
       AND l.activo AND m.activo
       AND (l.expira_en IS NULL OR l.expira_en > now())
     LIMIT 1;
$$;
REVOKE EXECUTE ON FUNCTION campana.info_link_publico(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION campana.info_link_publico(text) TO rol_app;

CREATE TABLE IF NOT EXISTS campana.solicitudes_lider (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    persona_id         uuid NOT NULL REFERENCES personas.personas(id) ON DELETE CASCADE,
    link_id            uuid NOT NULL REFERENCES campana.links_referido(id),
    miembro_invita_id  uuid NOT NULL REFERENCES campana.miembros(id),
    cargo_propuesto    text NOT NULL REFERENCES campana.cargos(codigo),
    zona_trabajo_id    integer REFERENCES territorio.territorios(id),
    meta_propuesta     integer CHECK (meta_propuesta BETWEEN 1 AND 100000),
    organizacion       text CHECK (length(organizacion) <= 120),
    estado             text NOT NULL DEFAULT 'PENDIENTE' CHECK (estado IN ('PENDIENTE', 'APROBADA', 'RECHAZADA')),
    creada_en          timestamptz NOT NULL DEFAULT now(),
    resuelta_por       uuid REFERENCES acceso.usuarios(id),
    resuelta_en        timestamptz,
    observacion        text,
    miembro_creado_id  uuid REFERENCES campana.miembros(id)
);
-- Una sola solicitud pendiente por persona.
CREATE UNIQUE INDEX IF NOT EXISTS uq_solicitud_pendiente ON campana.solicitudes_lider (persona_id) WHERE estado = 'PENDIENTE';

ALTER TABLE campana.solicitudes_lider ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_solicitudes_lider ON campana.solicitudes_lider;
CREATE POLICY p_solicitudes_lider ON campana.solicitudes_lider FOR SELECT
    USING (miembro_invita_id IN (SELECT miembro_id FROM campana.miembros_visibles()));
GRANT SELECT ON campana.solicitudes_lider TO rol_app;

DROP TRIGGER IF EXISTS trg_audit_solicitudes_lider ON campana.solicitudes_lider;
CREATE TRIGGER trg_audit_solicitudes_lider AFTER INSERT OR DELETE OR UPDATE ON campana.solicitudes_lider
    FOR EACH ROW EXECUTE FUNCTION auditoria.fn_registrar_cambio('id');

-- Crea la solicitud después del registro público. No revela nada: si el
-- enlace no es de líderes o la persona ya pertenece a la estructura, no hace nada.
CREATE OR REPLACE FUNCTION campana.solicitar_liderazgo(p_tipo_documento text, p_documento_hash bytea, p_codigo_link text,
                                                      p_zona_trabajo_id integer, p_meta integer, p_organizacion text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
    v_link    campana.links_referido%ROWTYPE;
    v_cargo   text;
    v_persona uuid;
BEGIN
    SELECT l.* INTO v_link
      FROM campana.links_referido l JOIN campana.miembros m ON m.id = l.miembro_id
     WHERE l.codigo = upper(btrim(p_codigo_link)) AND l.proposito = 'LIDER'
       AND l.activo AND m.activo AND (l.expira_en IS NULL OR l.expira_en > now());
    IF NOT FOUND THEN RETURN; END IF;

    SELECT campana.cargo_invitado(m.cargo_codigo) INTO v_cargo FROM campana.miembros m WHERE m.id = v_link.miembro_id;
    SELECT p.id INTO v_persona FROM personas.personas p
     WHERE p.tipo_documento_codigo = p_tipo_documento AND p.documento_hash = p_documento_hash;
    IF v_cargo IS NULL OR v_persona IS NULL
       OR EXISTS (SELECT 1 FROM campana.miembros m WHERE m.persona_id = v_persona)
       OR EXISTS (SELECT 1 FROM campana.solicitudes_lider s WHERE s.persona_id = v_persona AND s.estado = 'PENDIENTE') THEN
        RETURN;
    END IF;

    INSERT INTO campana.solicitudes_lider (persona_id, link_id, miembro_invita_id, cargo_propuesto,
                                           zona_trabajo_id, meta_propuesta, organizacion)
    VALUES (v_persona, v_link.id, v_link.miembro_id, v_cargo,
            (SELECT t.id FROM territorio.territorios t WHERE t.id = p_zona_trabajo_id AND t.tipo_codigo <> 'DEPARTAMENTO'),
            p_meta, nullif(btrim(p_organizacion), ''));
END $$;
REVOKE EXECUTE ON FUNCTION campana.solicitar_liderazgo(text, bytea, text, integer, integer, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION campana.solicitar_liderazgo(text, bytea, text, integer, integer, text) TO rol_app;

-- Solicitudes que el usuario puede ver, con los datos para decidir (el
-- celular va cifrado: la API lo descifra para que quien decide pueda llamar).
DROP FUNCTION IF EXISTS campana.solicitudes_lider_visibles(text);
CREATE FUNCTION campana.solicitudes_lider_visibles(p_estado text)
RETURNS TABLE (id uuid, persona_id uuid, nombre text, invita text, invita_id uuid, cargo_propuesto text,
               zona_trabajo text, municipio text, meta_propuesta integer, organizacion text, estado text,
               creada_en timestamptz, resuelta_en timestamptz, observacion text, es_propia boolean,
               telefono_cifrado bytea)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
    SELECT s.id, s.persona_id, p.nombres || ' ' || p.apellidos, pi.nombres || ' ' || pi.apellidos, s.miembro_invita_id,
           s.cargo_propuesto, z.nombre, coalesce(mz.nombre, mr.nombre), s.meta_propuesta, s.organizacion, s.estado,
           s.creada_en, s.resuelta_en, s.observacion,
           s.miembro_invita_id = (SELECT m.id FROM acceso.usuarios u JOIN campana.miembros m ON m.persona_id = u.persona_id
                                   WHERE u.id = acceso.usuario_actual()),
           (SELECT t.telefono_cifrado FROM personas.telefonos t WHERE t.persona_id = s.persona_id
             ORDER BY t.es_principal DESC LIMIT 1)
      FROM campana.solicitudes_lider s
      JOIN personas.personas p   ON p.id = s.persona_id
      JOIN campana.miembros mi   ON mi.id = s.miembro_invita_id
      JOIN personas.personas pi  ON pi.id = mi.persona_id
      LEFT JOIN territorio.territorios z  ON z.id = s.zona_trabajo_id
      LEFT JOIN territorio.territorios mz ON mz.id = territorio.ancestro(s.zona_trabajo_id, 'MUNICIPIO')
      LEFT JOIN campana.simpatizantes sp  ON sp.persona_id = s.persona_id
      LEFT JOIN territorio.territorios mr ON mr.id = territorio.ancestro(sp.territorio_residencia_id, 'MUNICIPIO')
     WHERE s.miembro_invita_id IN (SELECT miembro_id FROM campana.miembros_visibles())
       AND (p_estado IS NULL OR s.estado = p_estado)
     ORDER BY s.creada_en DESC
     LIMIT 200;
$$;
REVOKE EXECUTE ON FUNCTION campana.solicitudes_lider_visibles(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION campana.solicitudes_lider_visibles(text) TO rol_app;

-- Aprueba o rechaza. Puede hacerlo quien invitó o quien gestiona miembros y
-- ve a quien invitó. Al aprobar se crea el miembro (con su propio enlace de
-- votantes) bajo quien lo invitó, en su zona de trabajo.
CREATE OR REPLACE FUNCTION campana.resolver_solicitud_lider(p_id uuid, p_aprobar boolean, p_observacion text)
RETURNS TABLE (miembro_id uuid, codigo_link text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
#variable_conflict use_column
DECLARE
    v_s        campana.solicitudes_lider%ROWTYPE;
    v_propio   uuid;
    v_miembro  uuid;
BEGIN
    SELECT s.* INTO v_s FROM campana.solicitudes_lider s WHERE s.id = p_id FOR UPDATE;
    IF NOT FOUND OR v_s.miembro_invita_id NOT IN (SELECT mv.miembro_id FROM campana.miembros_visibles() mv) THEN
        RAISE EXCEPTION 'Solicitud no encontrada';
    END IF;
    SELECT m.id INTO v_propio FROM acceso.usuarios u JOIN campana.miembros m ON m.persona_id = u.persona_id
     WHERE u.id = acceso.usuario_actual();
    IF v_s.miembro_invita_id IS DISTINCT FROM v_propio AND NOT acceso.tiene_permiso('MIEMBRO_GESTIONAR') THEN
        RAISE EXCEPTION 'Solo quien invitó o quien gestiona la red puede resolver esta solicitud' USING ERRCODE = '42501';
    END IF;
    IF v_s.estado <> 'PENDIENTE' THEN
        RAISE EXCEPTION 'La solicitud ya fue resuelta';
    END IF;

    IF p_aprobar THEN
        IF EXISTS (SELECT 1 FROM campana.miembros m WHERE m.persona_id = v_s.persona_id) THEN
            RAISE EXCEPTION 'Esta persona ya pertenece a la estructura de la campaña';
        END IF;
        INSERT INTO campana.miembros (persona_id, cargo_codigo, superior_id)
        VALUES (v_s.persona_id, v_s.cargo_propuesto, v_s.miembro_invita_id)
        RETURNING id INTO v_miembro;
        IF v_s.zona_trabajo_id IS NOT NULL THEN
            INSERT INTO campana.miembro_territorios (miembro_id, territorio_id) VALUES (v_miembro, v_s.zona_trabajo_id);
        END IF;
    END IF;

    UPDATE campana.solicitudes_lider
       SET estado = CASE WHEN p_aprobar THEN 'APROBADA' ELSE 'RECHAZADA' END,
           resuelta_por = acceso.usuario_actual(), resuelta_en = now(),
           observacion = nullif(btrim(p_observacion), ''), miembro_creado_id = v_miembro
     WHERE id = p_id;

    RETURN QUERY
        SELECT v_miembro, (SELECT l.codigo FROM campana.links_referido l WHERE l.miembro_id = v_miembro AND l.es_principal);
END $$;
REVOKE EXECUTE ON FUNCTION campana.resolver_solicitud_lider(uuid, boolean, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION campana.resolver_solicitud_lider(uuid, boolean, text) TO rol_app;

REVOKE EXECUTE ON FUNCTION campana.mi_enlace_lideres() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION campana.mi_enlace_lideres() TO rol_app;

COMMIT;
