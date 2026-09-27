-- ============================================================================
-- 37. Día D: testigos por puesto y mesa, foto del E-14 y conteo rápido
-- ============================================================================
-- Permisos nuevos:
--   DIA_D_VER        tablero de conteo rápido (candidato, gerente, coordinador)
--   DIA_D_GESTIONAR  asignar testigos y revisar E-14 de su territorio
--                    (gerente, coordinador)
--   DIA_D_CONFIGURAR jornada activa, mesas y candidatos (gerente)
--   E14_CARGAR       (ya existía) el testigo carga el E-14 de SUS mesas
-- Requiere 36. Se puede ejecutar más de una vez.
-- ============================================================================

INSERT INTO acceso.permisos (codigo, descripcion) VALUES
  ('DIA_D_VER', 'Ver el conteo rápido del día de elecciones'),
  ('DIA_D_GESTIONAR', 'Asignar testigos y revisar formularios E-14 de su territorio'),
  ('DIA_D_CONFIGURAR', 'Configurar la jornada electoral, las mesas y los candidatos')
ON CONFLICT (codigo) DO NOTHING;
INSERT INTO acceso.rol_permisos (rol_codigo, permiso_codigo) VALUES
  ('CANDIDATO', 'DIA_D_VER'),
  ('GERENTE', 'DIA_D_VER'), ('GERENTE', 'DIA_D_GESTIONAR'), ('GERENTE', 'DIA_D_CONFIGURAR'),
  ('SUPERADMIN', 'DIA_D_VER'), ('SUPERADMIN', 'DIA_D_GESTIONAR'), ('SUPERADMIN', 'DIA_D_CONFIGURAR'),
  ('COORDINADOR', 'DIA_D_VER'), ('COORDINADOR', 'DIA_D_GESTIONAR')
ON CONFLICT DO NOTHING;

INSERT INTO campana.parametros (clave, valor, descripcion)
VALUES ('MESA_MAX_VOTANTES', '400', 'Si un E-14 suma más votos que esto, queda marcado con inconsistencias')
ON CONFLICT (clave) DO NOTHING;

CREATE OR REPLACE FUNCTION electoral.exigir(p_permiso text) RETURNS void
LANGUAGE plpgsql STABLE AS $$
BEGIN
    IF NOT acceso.tiene_permiso(p_permiso) THEN
        RAISE EXCEPTION 'Sin permiso para esta acción del día de elecciones' USING ERRCODE = '42501';
    END IF;
END $$;

-- ----------------------------------------------------------------------------
-- Jornada activa
-- ----------------------------------------------------------------------------
ALTER TABLE electoral.jornadas ADD COLUMN IF NOT EXISTS activa boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS uq_jornada_activa ON electoral.jornadas (activa) WHERE activa;
-- Si ninguna está activa, se activa la más reciente.
UPDATE electoral.jornadas SET activa = true
 WHERE id = (SELECT id FROM electoral.jornadas ORDER BY fecha DESC LIMIT 1)
   AND NOT EXISTS (SELECT 1 FROM electoral.jornadas WHERE activa);

CREATE OR REPLACE FUNCTION electoral.jornada_activa() RETURNS smallint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
    SELECT id FROM electoral.jornadas WHERE activa;
$$;
GRANT EXECUTE ON FUNCTION electoral.jornada_activa() TO rol_app;

-- Crea una jornada nueva copiando los puestos (y sus corporaciones) de otra,
-- y la deja activa. Las mesas se definen después, por puesto.
CREATE OR REPLACE FUNCTION electoral.crear_jornada(p_nombre text, p_tipo text, p_fecha date, p_copiar_de smallint)
RETURNS smallint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
    v_id smallint;
BEGIN
    PERFORM electoral.exigir('DIA_D_CONFIGURAR');
    INSERT INTO electoral.jornadas (nombre, tipo_codigo, fecha) VALUES (btrim(p_nombre), p_tipo, p_fecha) RETURNING id INTO v_id;
    INSERT INTO electoral.puestos_jornada (puesto_id, jornada_id)
    SELECT puesto_id, v_id FROM electoral.puestos_jornada WHERE jornada_id = p_copiar_de;
    INSERT INTO electoral.puestos_jornada_corporaciones (puesto_id, jornada_id, corporacion_codigo)
    SELECT puesto_id, v_id, corporacion_codigo FROM electoral.puestos_jornada_corporaciones WHERE jornada_id = p_copiar_de;
    -- Opciones que siempre están en el tarjetón.
    INSERT INTO electoral.opciones_voto (jornada_id, corporacion_codigo, tipo, nombre)
    SELECT v_id, c.corporacion_codigo, t.tipo, t.nombre
      FROM (SELECT DISTINCT corporacion_codigo FROM electoral.puestos_jornada_corporaciones WHERE jornada_id = v_id) c
     CROSS JOIN (VALUES ('BLANCO', 'Voto en blanco'), ('NULO', 'Votos nulos'), ('NO_MARCADO', 'Tarjetas no marcadas')) t(tipo, nombre);
    UPDATE electoral.jornadas SET activa = false WHERE activa;
    UPDATE electoral.jornadas SET activa = true WHERE id = v_id;
    RETURN v_id;
END $$;
REVOKE EXECUTE ON FUNCTION electoral.crear_jornada(text, text, date, smallint) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION electoral.crear_jornada(text, text, date, smallint) TO rol_app;

-- La jornada existente también necesita blanco, nulos y no marcados.
INSERT INTO electoral.opciones_voto (jornada_id, corporacion_codigo, tipo, nombre)
SELECT pj.jornada_id, pj.corporacion_codigo, t.tipo, t.nombre
  FROM (SELECT DISTINCT jornada_id, corporacion_codigo FROM electoral.puestos_jornada_corporaciones) pj
 CROSS JOIN (VALUES ('BLANCO', 'Voto en blanco'), ('NULO', 'Votos nulos'), ('NO_MARCADO', 'Tarjetas no marcadas')) t(tipo, nombre)
 WHERE NOT EXISTS (SELECT 1 FROM electoral.opciones_voto o
                    WHERE o.jornada_id = pj.jornada_id AND o.corporacion_codigo = pj.corporacion_codigo AND o.tipo = t.tipo);

-- ----------------------------------------------------------------------------
-- Candidatos (opciones de voto) de la jornada activa
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION electoral.guardar_candidato(p_corporacion text, p_nombre text, p_partido text, p_propio boolean)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
    v_partido smallint;
    v_id      integer;
BEGIN
    PERFORM electoral.exigir('DIA_D_CONFIGURAR');
    IF nullif(btrim(p_partido), '') IS NOT NULL THEN
        SELECT id INTO v_partido FROM electoral.partidos WHERE lower(nombre) = lower(btrim(p_partido));
        IF v_partido IS NULL THEN
            INSERT INTO electoral.partidos (nombre) VALUES (btrim(p_partido)) RETURNING id INTO v_partido;
        END IF;
    END IF;
    IF p_propio THEN
        UPDATE electoral.opciones_voto SET es_candidato_propio = false
         WHERE jornada_id = electoral.jornada_activa() AND corporacion_codigo = p_corporacion;
    END IF;
    INSERT INTO electoral.opciones_voto (jornada_id, corporacion_codigo, tipo, nombre, partido_id, es_candidato_propio)
    VALUES (electoral.jornada_activa(), p_corporacion, 'CANDIDATO', btrim(p_nombre), v_partido, p_propio)
    RETURNING id INTO v_id;
    RETURN v_id;
END $$;
REVOKE EXECUTE ON FUNCTION electoral.guardar_candidato(text, text, text, boolean) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION electoral.guardar_candidato(text, text, text, boolean) TO rol_app;

CREATE OR REPLACE FUNCTION electoral.quitar_candidato(p_id integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
    PERFORM electoral.exigir('DIA_D_CONFIGURAR');
    IF EXISTS (SELECT 1 FROM electoral.resultados_e14 WHERE opcion_voto_id = p_id) THEN
        RAISE EXCEPTION 'Ese candidato ya tiene votos cargados; no se puede quitar';
    END IF;
    DELETE FROM electoral.opciones_voto WHERE id = p_id AND tipo = 'CANDIDATO';
END $$;
REVOKE EXECUTE ON FUNCTION electoral.quitar_candidato(integer) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION electoral.quitar_candidato(integer) TO rol_app;

CREATE OR REPLACE FUNCTION electoral.opciones_jornada(p_corporacion text)
RETURNS TABLE (id integer, tipo text, nombre text, partido text, es_candidato_propio boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
    SELECT o.id, o.tipo, o.nombre, p.nombre, o.es_candidato_propio
      FROM electoral.opciones_voto o LEFT JOIN electoral.partidos p ON p.id = o.partido_id
     WHERE o.jornada_id = electoral.jornada_activa() AND o.corporacion_codigo = p_corporacion
       AND (acceso.tiene_permiso('DIA_D_VER') OR acceso.tiene_permiso('E14_CARGAR') OR acceso.tiene_permiso('DIA_D_CONFIGURAR'))
     ORDER BY CASE o.tipo WHEN 'CANDIDATO' THEN 0 WHEN 'BLANCO' THEN 1 WHEN 'NULO' THEN 2 ELSE 3 END,
              o.es_candidato_propio DESC, o.nombre;
$$;
GRANT EXECUTE ON FUNCTION electoral.opciones_jornada(text) TO rol_app;

-- ----------------------------------------------------------------------------
-- Mesas por puesto
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION electoral.definir_mesas(p_puesto_id integer, p_cantidad integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
    v_jornada smallint := electoral.jornada_activa();
BEGIN
    PERFORM electoral.exigir('DIA_D_CONFIGURAR');
    IF p_cantidad < 0 OR p_cantidad > 200 THEN
        RAISE EXCEPTION 'Cantidad de mesas no válida';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM electoral.puestos_jornada WHERE puesto_id = p_puesto_id AND jornada_id = v_jornada) THEN
        RAISE EXCEPTION 'El puesto no está en la jornada activa';
    END IF;
    IF EXISTS (SELECT 1 FROM electoral.mesas m
                WHERE m.puesto_id = p_puesto_id AND m.jornada_id = v_jornada AND m.numero > p_cantidad
                  AND (EXISTS (SELECT 1 FROM electoral.testigos t WHERE t.mesa_id = m.id)
                       OR EXISTS (SELECT 1 FROM electoral.formularios_e14 f WHERE f.mesa_id = m.id))) THEN
        RAISE EXCEPTION 'Hay mesas con testigo o E-14 por encima de ese número; quítelos primero';
    END IF;
    DELETE FROM electoral.mesas WHERE puesto_id = p_puesto_id AND jornada_id = v_jornada AND numero > p_cantidad;
    INSERT INTO electoral.mesas (puesto_id, jornada_id, numero)
    SELECT p_puesto_id, v_jornada, n FROM generate_series(1, p_cantidad) n
     WHERE NOT EXISTS (SELECT 1 FROM electoral.mesas m WHERE m.puesto_id = p_puesto_id AND m.jornada_id = v_jornada AND m.numero = n);
    RETURN p_cantidad;
END $$;
REVOKE EXECUTE ON FUNCTION electoral.definir_mesas(integer, integer) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION electoral.definir_mesas(integer, integer) TO rol_app;
CREATE UNIQUE INDEX IF NOT EXISTS uq_mesa_numero ON electoral.mesas (puesto_id, jornada_id, numero);

-- ----------------------------------------------------------------------------
-- Testigos: usuarios con rol TESTIGO, asignados a mesas de un mismo puesto.
-- (La tabla anterior apuntaba a miembros de la red y no tenía datos.)
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'electoral' AND table_name = 'testigos' AND column_name = 'miembro_id') THEN
        IF EXISTS (SELECT 1 FROM electoral.testigos) THEN
            RAISE EXCEPTION 'electoral.testigos tiene datos con el formato anterior: revíselos antes de migrar';
        END IF;
        DROP VIEW IF EXISTS electoral.v_cobertura_testigos;
        DROP TABLE electoral.testigos;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS electoral.testigos (
    mesa_id      integer PRIMARY KEY REFERENCES electoral.mesas(id) ON DELETE CASCADE,
    usuario_id   uuid NOT NULL REFERENCES acceso.usuarios(id) ON DELETE CASCADE,
    asignado_por uuid REFERENCES acceso.usuarios(id) ON DELETE SET NULL,
    asignado_en  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_testigos_usuario ON electoral.testigos (usuario_id);

CREATE OR REPLACE VIEW electoral.v_cobertura_testigos WITH (security_invoker = true) AS
SELECT m.jornada_id, m.puesto_id, pv.nombre AS puesto,
       count(DISTINCT m.id) AS mesas,
       count(DISTINCT t.mesa_id) AS mesas_con_testigo,
       count(DISTINCT m.id) - count(DISTINCT t.mesa_id) AS mesas_sin_testigo
  FROM electoral.mesas m
  JOIN electoral.puestos_votacion pv ON pv.id = m.puesto_id
  LEFT JOIN electoral.testigos t ON t.mesa_id = m.id
 GROUP BY m.jornada_id, m.puesto_id, pv.nombre;
GRANT SELECT ON electoral.testigos TO rol_app;

CREATE OR REPLACE FUNCTION electoral.fn_validar_testigo() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM acceso.usuario_roles WHERE usuario_id = NEW.usuario_id AND rol_codigo = 'TESTIGO') THEN
        RAISE EXCEPTION 'El usuario no tiene el rol de testigo';
    END IF;
    IF EXISTS (
        SELECT 1 FROM electoral.testigos t
          JOIN electoral.mesas otra ON otra.id = t.mesa_id
          JOIN electoral.mesas esta ON esta.id = NEW.mesa_id
         WHERE t.usuario_id = NEW.usuario_id AND t.mesa_id <> NEW.mesa_id
           AND otra.jornada_id = esta.jornada_id AND otra.puesto_id <> esta.puesto_id
    ) THEN
        RAISE EXCEPTION 'Este testigo ya tiene mesas en otro puesto de la misma jornada';
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_testigos_validar ON electoral.testigos;
CREATE TRIGGER trg_testigos_validar BEFORE INSERT OR UPDATE ON electoral.testigos
FOR EACH ROW EXECUTE FUNCTION electoral.fn_validar_testigo();
DROP TRIGGER IF EXISTS trg_audit_testigos ON electoral.testigos;
CREATE TRIGGER trg_audit_testigos AFTER INSERT OR DELETE OR UPDATE ON electoral.testigos
FOR EACH ROW EXECUTE FUNCTION auditoria.fn_registrar_cambio('mesa_id');

-- ¿El puesto está en el territorio de quien consulta?
CREATE OR REPLACE FUNCTION electoral.puesto_visible(p_puesto_id integer) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
    SELECT EXISTS (SELECT 1 FROM electoral.puestos_votacion pv
                    WHERE pv.id = p_puesto_id
                      AND pv.territorio_id IN (SELECT territorio_id FROM acceso.territorios_visibles()));
$$;
GRANT EXECUTE ON FUNCTION electoral.puesto_visible(integer) TO rol_app;

-- Puestos de la jornada activa en el territorio del usuario, con avance.
CREATE OR REPLACE FUNCTION electoral.puestos_dia_d(p_municipio_id integer DEFAULT NULL)
RETURNS TABLE (puesto_id integer, puesto text, municipio_id integer, municipio text, mesas bigint,
               con_testigo bigint, e14_cargados bigint, potencial integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
    SELECT pv.id, pv.nombre, territorio.ancestro(pv.territorio_id, 'MUNICIPIO'),
           (SELECT t.nombre FROM territorio.territorios t WHERE t.id = territorio.ancestro(pv.territorio_id, 'MUNICIPIO')),
           (SELECT count(*) FROM electoral.mesas m WHERE m.puesto_id = pv.id AND m.jornada_id = pj.jornada_id),
           (SELECT count(*) FROM electoral.mesas m JOIN electoral.testigos t ON t.mesa_id = m.id
             WHERE m.puesto_id = pv.id AND m.jornada_id = pj.jornada_id),
           (SELECT count(DISTINCT f.mesa_id) FROM electoral.mesas m JOIN electoral.formularios_e14 f ON f.mesa_id = m.id
             WHERE m.puesto_id = pv.id AND m.jornada_id = pj.jornada_id),
           pj.potencial_electoral
      FROM electoral.puestos_jornada pj
      JOIN electoral.puestos_votacion pv ON pv.id = pj.puesto_id
     WHERE pj.jornada_id = electoral.jornada_activa()
       AND (acceso.tiene_permiso('DIA_D_GESTIONAR') OR acceso.tiene_permiso('DIA_D_CONFIGURAR') OR acceso.tiene_permiso('DIA_D_VER'))
       AND electoral.puesto_visible(pv.id)
       AND (p_municipio_id IS NULL OR territorio.ancestro(pv.territorio_id, 'MUNICIPIO') = p_municipio_id)
     ORDER BY 4, 2;
$$;
GRANT EXECUTE ON FUNCTION electoral.puestos_dia_d(integer) TO rol_app;

-- Mesas de un puesto con su testigo y su E-14.
CREATE OR REPLACE FUNCTION electoral.mesas_puesto(p_puesto_id integer)
RETURNS TABLE (mesa_id integer, numero smallint, testigo_id uuid, testigo text, testigo_login text,
               formularios bigint, estado_revision text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
    SELECT m.id, m.numero, t.usuario_id, p.nombres || ' ' || p.apellidos, u.login,
           (SELECT count(*) FROM electoral.formularios_e14 f WHERE f.mesa_id = m.id),
           (SELECT string_agg(DISTINCT f.estado_revision, ',') FROM electoral.formularios_e14 f WHERE f.mesa_id = m.id)
      FROM electoral.mesas m
      LEFT JOIN electoral.testigos t ON t.mesa_id = m.id
      LEFT JOIN acceso.usuarios u ON u.id = t.usuario_id
      LEFT JOIN personas.personas p ON p.id = u.persona_id
     WHERE m.puesto_id = p_puesto_id AND m.jornada_id = electoral.jornada_activa()
       AND (acceso.tiene_permiso('DIA_D_GESTIONAR') OR acceso.tiene_permiso('DIA_D_CONFIGURAR'))
       AND electoral.puesto_visible(p_puesto_id)
     ORDER BY m.numero;
$$;
GRANT EXECUTE ON FUNCTION electoral.mesas_puesto(integer) TO rol_app;

-- Usuarios testigo que el usuario puede asignar (de su territorio).
CREATE OR REPLACE FUNCTION electoral.testigos_disponibles()
RETURNS TABLE (usuario_id uuid, nombre text, login text, municipio text, puesto text, mesas bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
    SELECT u.id, p.nombres || ' ' || p.apellidos, u.login,
           (SELECT string_agg(t.nombre, ', ') FROM acceso.usuario_territorios ut JOIN territorio.territorios t ON t.id = ut.territorio_id
             WHERE ut.usuario_id = u.id),
           (SELECT min(pv.nombre) FROM electoral.testigos te JOIN electoral.mesas m ON m.id = te.mesa_id
              JOIN electoral.puestos_votacion pv ON pv.id = m.puesto_id
             WHERE te.usuario_id = u.id AND m.jornada_id = electoral.jornada_activa()),
           (SELECT count(*) FROM electoral.testigos te JOIN electoral.mesas m ON m.id = te.mesa_id
             WHERE te.usuario_id = u.id AND m.jornada_id = electoral.jornada_activa())
      FROM acceso.usuarios u
      JOIN acceso.usuario_roles ur ON ur.usuario_id = u.id AND ur.rol_codigo = 'TESTIGO'
      JOIN personas.personas p ON p.id = u.persona_id
     WHERE u.activo
       AND (acceso.tiene_permiso('DIA_D_GESTIONAR') OR acceso.tiene_permiso('DIA_D_CONFIGURAR'))
       AND (NOT EXISTS (SELECT 1 FROM acceso.usuario_territorios ut WHERE ut.usuario_id = u.id)
            OR EXISTS (SELECT 1 FROM acceso.usuario_territorios ut
                        WHERE ut.usuario_id = u.id AND ut.territorio_id IN (SELECT territorio_id FROM acceso.territorios_visibles())))
     ORDER BY 2;
$$;
GRANT EXECUTE ON FUNCTION electoral.testigos_disponibles() TO rol_app;

CREATE OR REPLACE FUNCTION electoral.asignar_testigo(p_mesa_id integer, p_usuario_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
    v_puesto integer;
BEGIN
    PERFORM electoral.exigir('DIA_D_GESTIONAR');
    SELECT puesto_id INTO v_puesto FROM electoral.mesas WHERE id = p_mesa_id AND jornada_id = electoral.jornada_activa();
    IF v_puesto IS NULL OR NOT electoral.puesto_visible(v_puesto) THEN
        RAISE EXCEPTION 'Mesa fuera de tu territorio o de la jornada activa' USING ERRCODE = '42501';
    END IF;
    IF p_usuario_id IS NULL THEN
        DELETE FROM electoral.testigos WHERE mesa_id = p_mesa_id;
        RETURN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM electoral.testigos_disponibles() d WHERE d.usuario_id = p_usuario_id) THEN
        RAISE EXCEPTION 'Ese testigo no está disponible en tu territorio' USING ERRCODE = '42501';
    END IF;
    INSERT INTO electoral.testigos (mesa_id, usuario_id, asignado_por) VALUES (p_mesa_id, p_usuario_id, acceso.usuario_actual())
    ON CONFLICT (mesa_id) DO UPDATE SET usuario_id = EXCLUDED.usuario_id, asignado_por = EXCLUDED.asignado_por, asignado_en = now();
END $$;
REVOKE EXECUTE ON FUNCTION electoral.asignar_testigo(integer, uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION electoral.asignar_testigo(integer, uuid) TO rol_app;

-- ----------------------------------------------------------------------------
-- E-14: el testigo carga la foto y los votos de SUS mesas
-- ----------------------------------------------------------------------------
ALTER TABLE electoral.formularios_e14
  ADD COLUMN IF NOT EXISTS total_votos integer,
  ADD COLUMN IF NOT EXISTS observacion text,
  ADD COLUMN IF NOT EXISTS revisado_por uuid REFERENCES acceso.usuarios(id),
  ADD COLUMN IF NOT EXISTS revisado_en timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS uq_e14_mesa_corporacion ON electoral.formularios_e14 (mesa_id, corporacion_codigo);

-- Mesas del testigo en la jornada activa.
CREATE OR REPLACE FUNCTION electoral.mis_mesas()
RETURNS TABLE (mesa_id integer, numero smallint, puesto text, direccion text, municipio text, corporacion text,
               corporacion_nombre text, formulario_id uuid, estado_revision text, cargado_en timestamptz, total_votos integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
    SELECT m.id, m.numero, pv.nombre, pv.direccion,
           (SELECT t.nombre FROM territorio.territorios t WHERE t.id = territorio.ancestro(pv.territorio_id, 'MUNICIPIO')),
           pjc.corporacion_codigo, c.nombre, f.id, f.estado_revision, f.cargado_en, f.total_votos
      FROM electoral.testigos te
      JOIN electoral.mesas m ON m.id = te.mesa_id AND m.jornada_id = electoral.jornada_activa()
      JOIN electoral.puestos_votacion pv ON pv.id = m.puesto_id
      JOIN electoral.puestos_jornada_corporaciones pjc ON pjc.puesto_id = m.puesto_id AND pjc.jornada_id = m.jornada_id
      JOIN electoral.corporaciones c ON c.codigo = pjc.corporacion_codigo
      LEFT JOIN electoral.formularios_e14 f ON f.mesa_id = m.id AND f.corporacion_codigo = pjc.corporacion_codigo
     WHERE te.usuario_id = acceso.usuario_actual()
     ORDER BY pv.nombre, m.numero, pjc.corporacion_codigo;
$$;
GRANT EXECUTE ON FUNCTION electoral.mis_mesas() TO rol_app;

-- Guarda (o reemplaza, mientras no esté validado) el E-14 de una mesa.
-- p_votos: {"<opcion_voto_id>": votos, ...}
CREATE OR REPLACE FUNCTION electoral.cargar_e14(p_mesa_id integer, p_corporacion text, p_ruta text, p_sha256 bytea, p_votos jsonb)
RETURNS TABLE (formulario_id uuid, estado_revision text, total integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
    v_mesa     electoral.mesas%ROWTYPE;
    v_id       uuid;
    v_estado   text;
    v_total    integer;
    v_faltan   integer;
BEGIN
    SELECT * INTO v_mesa FROM electoral.mesas WHERE id = p_mesa_id AND jornada_id = electoral.jornada_activa();
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Mesa no encontrada en la jornada activa';
    END IF;
    -- El testigo solo carga sus mesas; quien gestiona el Día D, las de su territorio.
    IF NOT (EXISTS (SELECT 1 FROM electoral.testigos t WHERE t.mesa_id = p_mesa_id AND t.usuario_id = acceso.usuario_actual())
            AND acceso.tiene_permiso('E14_CARGAR'))
       AND NOT (acceso.tiene_permiso('DIA_D_GESTIONAR') AND electoral.puesto_visible(v_mesa.puesto_id)) THEN
        RAISE EXCEPTION 'Esta mesa no está asignada a ti' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM electoral.puestos_jornada_corporaciones
                    WHERE puesto_id = v_mesa.puesto_id AND jornada_id = v_mesa.jornada_id AND corporacion_codigo = p_corporacion) THEN
        RAISE EXCEPTION 'Esa corporación no se vota en este puesto';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_each_text(p_votos) v WHERE v.value !~ '^\d{1,4}$') THEN
        RAISE EXCEPTION 'Los votos deben ser números enteros entre 0 y 9999';
    END IF;
    SELECT count(*) INTO v_faltan FROM electoral.opciones_voto o
     WHERE o.jornada_id = v_mesa.jornada_id AND o.corporacion_codigo = p_corporacion AND NOT (p_votos ? o.id::text);
    IF v_faltan > 0 THEN
        RAISE EXCEPTION 'Faltan votos de % opciones del tarjetón', v_faltan;
    END IF;

    SELECT f.id, f.estado_revision INTO v_id, v_estado FROM electoral.formularios_e14 f
     WHERE f.mesa_id = p_mesa_id AND f.corporacion_codigo = p_corporacion FOR UPDATE;
    IF v_estado = 'VALIDADO' THEN
        RAISE EXCEPTION 'Este E-14 ya fue validado; para corregirlo, pide a la coordinación que lo reabra';
    END IF;

    SELECT sum(value::integer) INTO v_total FROM jsonb_each_text(p_votos);
    v_estado := CASE WHEN v_total > campana.parametro_int('MESA_MAX_VOTANTES') THEN 'CON_INCONSISTENCIAS' ELSE 'PENDIENTE' END;

    IF v_id IS NULL THEN
        INSERT INTO electoral.formularios_e14 (mesa_id, corporacion_codigo, archivo_ruta, archivo_sha256, cargado_por, estado_revision, total_votos, observacion)
        VALUES (p_mesa_id, p_corporacion, p_ruta, p_sha256, acceso.usuario_actual(), v_estado, v_total,
                CASE WHEN v_estado = 'CON_INCONSISTENCIAS' THEN format('Suma %s votos, más del máximo por mesa', v_total) END)
        RETURNING id INTO v_id;
    ELSE
        UPDATE electoral.formularios_e14 SET archivo_ruta = p_ruta, archivo_sha256 = p_sha256, cargado_por = acceso.usuario_actual(),
               cargado_en = now(), estado_revision = v_estado, total_votos = v_total,
               observacion = CASE WHEN v_estado = 'CON_INCONSISTENCIAS' THEN format('Suma %s votos, más del máximo por mesa', v_total) END
         WHERE id = v_id;
        DELETE FROM electoral.resultados_e14 WHERE formulario_id = v_id;
    END IF;

    INSERT INTO electoral.resultados_e14 (formulario_id, opcion_voto_id, votos)
    SELECT v_id, v.key::integer, v.value::integer FROM jsonb_each_text(p_votos) v
      JOIN electoral.opciones_voto o ON o.id = v.key::integer
     WHERE o.jornada_id = v_mesa.jornada_id AND o.corporacion_codigo = p_corporacion;

    RETURN QUERY SELECT v_id, v_estado, v_total;
END $$;
REVOKE EXECUTE ON FUNCTION electoral.cargar_e14(integer, text, text, bytea, jsonb) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION electoral.cargar_e14(integer, text, text, bytea, jsonb) TO rol_app;

-- Ruta de la foto, si quien pregunta puede verla (el testigo de la mesa o
-- quien gestiona el Día D en ese territorio).
CREATE OR REPLACE FUNCTION electoral.foto_e14(p_formulario_id uuid) RETURNS TABLE (ruta text, sha256 bytea)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
    SELECT f.archivo_ruta, f.archivo_sha256
      FROM electoral.formularios_e14 f JOIN electoral.mesas m ON m.id = f.mesa_id
     WHERE f.id = p_formulario_id
       AND ((acceso.tiene_permiso('DIA_D_GESTIONAR') AND electoral.puesto_visible(m.puesto_id))
            OR EXISTS (SELECT 1 FROM electoral.testigos t WHERE t.mesa_id = m.id AND t.usuario_id = acceso.usuario_actual()));
$$;
GRANT EXECUTE ON FUNCTION electoral.foto_e14(uuid) TO rol_app;

-- Formularios para revisar, con sus votos.
CREATE OR REPLACE FUNCTION electoral.formularios_revision(p_estado text, p_municipio_id integer)
RETURNS TABLE (formulario_id uuid, municipio text, puesto text, mesa smallint, corporacion text, estado_revision text,
               total_votos integer, observacion text, cargado_en timestamptz, cargado_por text, votos jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
    SELECT f.id,
           (SELECT t.nombre FROM territorio.territorios t WHERE t.id = territorio.ancestro(pv.territorio_id, 'MUNICIPIO')),
           pv.nombre, m.numero, f.corporacion_codigo, f.estado_revision, f.total_votos, f.observacion, f.cargado_en, u.login,
           (SELECT jsonb_agg(jsonb_build_object('opcion', o.nombre, 'votos', r.votos) ORDER BY o.tipo, o.nombre)
              FROM electoral.resultados_e14 r JOIN electoral.opciones_voto o ON o.id = r.opcion_voto_id
             WHERE r.formulario_id = f.id)
      FROM electoral.formularios_e14 f
      JOIN electoral.mesas m ON m.id = f.mesa_id AND m.jornada_id = electoral.jornada_activa()
      JOIN electoral.puestos_votacion pv ON pv.id = m.puesto_id
      JOIN acceso.usuarios u ON u.id = f.cargado_por
     WHERE acceso.tiene_permiso('DIA_D_GESTIONAR') AND electoral.puesto_visible(pv.id)
       AND (p_estado IS NULL OR f.estado_revision = p_estado)
       AND (p_municipio_id IS NULL OR territorio.ancestro(pv.territorio_id, 'MUNICIPIO') = p_municipio_id)
     ORDER BY CASE f.estado_revision WHEN 'CON_INCONSISTENCIAS' THEN 0 WHEN 'PENDIENTE' THEN 1 ELSE 2 END, f.cargado_en DESC
     LIMIT 300;
$$;
GRANT EXECUTE ON FUNCTION electoral.formularios_revision(text, integer) TO rol_app;

CREATE OR REPLACE FUNCTION electoral.revisar_e14(p_formulario_id uuid, p_estado text, p_observacion text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
    v_puesto integer;
BEGIN
    PERFORM electoral.exigir('DIA_D_GESTIONAR');
    SELECT m.puesto_id INTO v_puesto FROM electoral.formularios_e14 f JOIN electoral.mesas m ON m.id = f.mesa_id WHERE f.id = p_formulario_id;
    IF v_puesto IS NULL OR NOT electoral.puesto_visible(v_puesto) THEN
        RAISE EXCEPTION 'Formulario fuera de tu territorio' USING ERRCODE = '42501';
    END IF;
    IF p_estado NOT IN ('VALIDADO', 'CON_INCONSISTENCIAS', 'PENDIENTE') THEN
        RAISE EXCEPTION 'Estado no válido';
    END IF;
    UPDATE electoral.formularios_e14 SET estado_revision = p_estado, observacion = nullif(btrim(p_observacion), ''),
           revisado_por = acceso.usuario_actual(), revisado_en = now()
     WHERE id = p_formulario_id;
END $$;
REVOKE EXECUTE ON FUNCTION electoral.revisar_e14(uuid, text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION electoral.revisar_e14(uuid, text, text) TO rol_app;

-- ----------------------------------------------------------------------------
-- Conteo rápido
-- ----------------------------------------------------------------------------
-- Totales por opción y avance de mesas (en el territorio de quien consulta).
CREATE OR REPLACE FUNCTION electoral.conteo_rapido(p_corporacion text, p_municipio_id integer DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
    v_resultado jsonb;
BEGIN
    PERFORM electoral.exigir('DIA_D_VER');
    WITH mesas AS (
        SELECT m.id, territorio.ancestro(pv.territorio_id, 'MUNICIPIO') AS municipio_id, pj.potencial_electoral, pv.id AS puesto_id
          FROM electoral.mesas m
          JOIN electoral.puestos_votacion pv ON pv.id = m.puesto_id
          JOIN electoral.puestos_jornada pj ON pj.puesto_id = m.puesto_id AND pj.jornada_id = m.jornada_id
          JOIN electoral.puestos_jornada_corporaciones pjc ON pjc.puesto_id = m.puesto_id AND pjc.jornada_id = m.jornada_id
                                                         AND pjc.corporacion_codigo = p_corporacion
         WHERE m.jornada_id = electoral.jornada_activa()
           AND pv.territorio_id IN (SELECT territorio_id FROM acceso.territorios_visibles())
           AND (p_municipio_id IS NULL OR territorio.ancestro(pv.territorio_id, 'MUNICIPIO') = p_municipio_id)
    ), forms AS (
        SELECT f.id, f.mesa_id, f.estado_revision, f.cargado_en, ms.municipio_id
          FROM electoral.formularios_e14 f JOIN mesas ms ON ms.id = f.mesa_id
         WHERE f.corporacion_codigo = p_corporacion
    ), votos AS (
        SELECT o.id, o.nombre, o.tipo, o.es_candidato_propio, p.nombre AS partido, coalesce(sum(r.votos), 0) AS votos,
               coalesce(sum(r.votos) FILTER (WHERE fo.estado_revision = 'VALIDADO'), 0) AS votos_validados
          FROM electoral.opciones_voto o
          LEFT JOIN electoral.partidos p ON p.id = o.partido_id
          LEFT JOIN electoral.resultados_e14 r ON r.opcion_voto_id = o.id AND r.formulario_id IN (SELECT id FROM forms)
          LEFT JOIN forms fo ON fo.id = r.formulario_id
         WHERE o.jornada_id = electoral.jornada_activa() AND o.corporacion_codigo = p_corporacion
         GROUP BY o.id, o.nombre, o.tipo, o.es_candidato_propio, p.nombre
    ), por_municipio AS (
        SELECT ms.municipio_id, t.nombre, count(DISTINCT ms.id) AS mesas, count(DISTINCT fo.mesa_id) AS reportadas,
               coalesce((SELECT sum(r.votos) FROM electoral.resultados_e14 r JOIN forms f2 ON f2.id = r.formulario_id
                          JOIN electoral.opciones_voto o ON o.id = r.opcion_voto_id
                         WHERE f2.municipio_id = ms.municipio_id AND o.es_candidato_propio), 0) AS votos_propios,
               coalesce((SELECT sum(r.votos) FROM electoral.resultados_e14 r JOIN forms f2 ON f2.id = r.formulario_id
                         WHERE f2.municipio_id = ms.municipio_id), 0) AS votos_total
          FROM mesas ms
          JOIN territorio.territorios t ON t.id = ms.municipio_id
          LEFT JOIN forms fo ON fo.mesa_id = ms.id
         GROUP BY ms.municipio_id, t.nombre
    )
    SELECT jsonb_build_object(
        'jornada', (SELECT jsonb_build_object('id', id, 'nombre', nombre, 'fecha', fecha) FROM electoral.jornadas WHERE activa),
        'mesas', (SELECT count(*) FROM mesas),
        'reportadas', (SELECT count(DISTINCT mesa_id) FROM forms),
        'validadas', (SELECT count(*) FROM forms WHERE estado_revision = 'VALIDADO'),
        'inconsistentes', (SELECT count(*) FROM forms WHERE estado_revision = 'CON_INCONSISTENCIAS'),
        'ultimo_reporte', (SELECT max(cargado_en) FROM forms),
        'potencial', (SELECT sum(potencial_electoral) FROM (SELECT DISTINCT puesto_id, potencial_electoral FROM mesas) x),
        'opciones', coalesce((SELECT jsonb_agg(to_jsonb(vt) ORDER BY vt.votos DESC, vt.nombre) FROM votos vt), '[]'::jsonb),
        'municipios', coalesce((SELECT jsonb_agg(to_jsonb(pm) ORDER BY pm.nombre) FROM por_municipio pm), '[]'::jsonb)
    ) INTO v_resultado;
    RETURN v_resultado;
END $$;
REVOKE EXECUTE ON FUNCTION electoral.conteo_rapido(text, integer) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION electoral.conteo_rapido(text, integer) TO rol_app;

-- Jornadas y corporaciones de la jornada activa (para los selectores).
CREATE OR REPLACE FUNCTION electoral.resumen_jornadas()
RETURNS TABLE (id smallint, nombre text, tipo_codigo text, fecha date, activa boolean, corporaciones text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
    SELECT j.id, j.nombre, j.tipo_codigo, j.fecha, j.activa,
           (SELECT array_agg(DISTINCT corporacion_codigo) FROM electoral.puestos_jornada_corporaciones pjc WHERE pjc.jornada_id = j.id)
      FROM electoral.jornadas j
     ORDER BY j.fecha DESC;
$$;
GRANT EXECUTE ON FUNCTION electoral.resumen_jornadas() TO rol_app;

-- Las tablas del Día D solo se tocan por estas funciones.
REVOKE INSERT, UPDATE, DELETE ON electoral.testigos, electoral.formularios_e14, electoral.resultados_e14,
       electoral.mesas, electoral.opciones_voto FROM rol_app;
