-- =============================================================================
--  14_agenda_territorial.sql
--  Agenda territorial del candidato: visitas, planteamientos de la comunidad,
--  reportes comunitarios de los líderes, compromisos y cobertura en el mapa.
--
--  Reutiliza tablas existentes:
--    eventos.eventos          -> cada visita, reunión o foro
--    participacion.necesidades -> planteamientos, reportes y necesidades del
--                                 formulario, distinguidos por "origen"
--  Requiere: 01 a 05 y 10 a 13. Se puede ejecutar más de una vez.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. VISITAS (extiende eventos.eventos)
-- -----------------------------------------------------------------------------
INSERT INTO eventos.tipos_evento (codigo, nombre) VALUES
    ('REUNION_LIDERES', 'Reunión con líderes'),
    ('RECORRIDO',       'Recorrido')
ON CONFLICT (codigo) DO NOTHING;

ALTER TABLE eventos.eventos
    ADD COLUMN IF NOT EXISTS estado text NOT NULL DEFAULT 'REALIZADA',
    ADD COLUMN IF NOT EXISTS con_candidato boolean NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS asistentes_aprox integer,
    ADD COLUMN IF NOT EXISTS resumen text,
    ADD COLUMN IF NOT EXISTS actualizada_en timestamptz NOT NULL DEFAULT now();

ALTER TABLE eventos.eventos ALTER COLUMN codigo_checkin SET DEFAULT util.generar_codigo(10);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_evento_estado') THEN
        ALTER TABLE eventos.eventos ADD CONSTRAINT ck_evento_estado
            CHECK (estado IN ('PROGRAMADA','REALIZADA','CANCELADA'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_evento_asistentes') THEN
        ALTER TABLE eventos.eventos ADD CONSTRAINT ck_evento_asistentes
            CHECK (asistentes_aprox IS NULL OR asistentes_aprox >= 0);
    END IF;
END $$;

DROP TRIGGER IF EXISTS trg_eventos_fecha ON eventos.eventos;
CREATE TRIGGER trg_eventos_fecha BEFORE UPDATE ON eventos.eventos
FOR EACH ROW EXECUTE FUNCTION util.fn_actualizar_fecha();

DROP TRIGGER IF EXISTS trg_eventos_nivel ON eventos.eventos;
CREATE TRIGGER trg_eventos_nivel
BEFORE INSERT OR UPDATE OF territorio_id ON eventos.eventos
FOR EACH ROW EXECUTE FUNCTION territorio.fn_exigir_nivel_municipal('territorio_id');

-- Líderes de la estructura presentes en la visita (distinto de organizadores).
CREATE TABLE IF NOT EXISTS eventos.lideres_presentes (
    evento_id   uuid NOT NULL REFERENCES eventos.eventos(id) ON DELETE CASCADE,
    miembro_id  uuid NOT NULL REFERENCES campana.miembros(id),
    PRIMARY KEY (evento_id, miembro_id)
);

-- Organizaciones de la comunidad presentes (JAC, asociaciones...). Se registran
-- organizaciones y no nombres de personas, para no guardar datos personales
-- de terceros sin su autorización.
CREATE TABLE IF NOT EXISTS eventos.tipos_organizacion (
    codigo  text PRIMARY KEY,
    nombre  text NOT NULL
);
INSERT INTO eventos.tipos_organizacion (codigo, nombre) VALUES
    ('JAC',          'Junta de Acción Comunal'),
    ('ASOCIACION',   'Asociación o cooperativa'),
    ('EDUCATIVA',    'Institución educativa'),
    ('RELIGIOSA',    'Organización religiosa'),
    ('ETNICA',       'Organización étnica o cabildo'),
    ('JUVENIL',      'Organización juvenil'),
    ('MUJERES',      'Organización de mujeres'),
    ('OTRA',         'Otra')
ON CONFLICT (codigo) DO NOTHING;

CREATE TABLE IF NOT EXISTS eventos.organizaciones_presentes (
    evento_id    uuid NOT NULL REFERENCES eventos.eventos(id) ON DELETE CASCADE,
    nombre       text NOT NULL,
    tipo_codigo  text NOT NULL REFERENCES eventos.tipos_organizacion(codigo),
    PRIMARY KEY (evento_id, nombre)
);

-- -----------------------------------------------------------------------------
-- 2. NECESIDADES CON ORIGEN
--   REGISTRO       la persona al inscribirse (o el líder que la inscribe)
--   VISITA         planteada en una visita, escrita por el equipo
--   REPORTE_LIDER  reporte comunitario de un líder sobre su vereda o barrio
-- -----------------------------------------------------------------------------
ALTER TABLE participacion.necesidades
    ADD COLUMN IF NOT EXISTS origen text NOT NULL DEFAULT 'REGISTRO',
    ADD COLUMN IF NOT EXISTS evento_id uuid REFERENCES eventos.eventos(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS reportado_por uuid REFERENCES acceso.usuarios(id),
    ADD COLUMN IF NOT EXISTS prioridad text;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_necesidad_origen') THEN
        ALTER TABLE participacion.necesidades ADD CONSTRAINT ck_necesidad_origen
            CHECK (origen IN ('REGISTRO','VISITA','REPORTE_LIDER'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_necesidad_prioridad') THEN
        ALTER TABLE participacion.necesidades ADD CONSTRAINT ck_necesidad_prioridad
            CHECK (prioridad IS NULL OR prioridad IN ('ALTA','MEDIA','BAJA'));
    END IF;
    -- Coherencia entre origen y datos: una visita exige el evento; un reporte
    -- de líder o de visita exige saber quién lo ingresó.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_necesidad_coherencia') THEN
        ALTER TABLE participacion.necesidades ADD CONSTRAINT ck_necesidad_coherencia CHECK (
            (origen = 'REGISTRO') OR
            (origen = 'VISITA' AND evento_id IS NOT NULL AND reportado_por IS NOT NULL) OR
            (origen = 'REPORTE_LIDER' AND reportado_por IS NOT NULL)
        );
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_necesidades_evento ON participacion.necesidades(evento_id);
CREATE INDEX IF NOT EXISTS ix_necesidades_origen ON participacion.necesidades(origen);

-- Si no se indica territorio: el de la persona, o el de la visita.
CREATE OR REPLACE FUNCTION participacion.fn_territorio_necesidad() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
    IF NEW.territorio_id IS NULL AND NEW.persona_id IS NOT NULL THEN
        SELECT territorio_residencia_id INTO NEW.territorio_id
          FROM campana.simpatizantes WHERE persona_id = NEW.persona_id;
    END IF;
    IF NEW.territorio_id IS NULL AND NEW.evento_id IS NOT NULL THEN
        SELECT territorio_id INTO NEW.territorio_id
          FROM eventos.eventos WHERE id = NEW.evento_id;
    END IF;
    RETURN NEW;
END $$;

-- -----------------------------------------------------------------------------
-- 3. COMPROMISOS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS participacion.compromisos (
    id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    evento_id              uuid REFERENCES eventos.eventos(id) ON DELETE SET NULL,
    territorio_id          integer NOT NULL REFERENCES territorio.territorios(id),
    categoria_codigo       text REFERENCES participacion.categorias_necesidad(codigo),
    descripcion            text NOT NULL,
    estado                 text NOT NULL DEFAULT 'PENDIENTE'
                           CHECK (estado IN ('PENDIENTE','EN_PROGRAMA','CUMPLIDO','DESCARTADO')),
    propuesta_id           uuid REFERENCES participacion.propuestas(id),
    responsable_miembro_id uuid REFERENCES campana.miembros(id),
    creado_por             uuid NOT NULL REFERENCES acceso.usuarios(id),
    creado_en              timestamptz NOT NULL DEFAULT now(),
    actualizada_en         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_compromiso_programa CHECK (estado <> 'EN_PROGRAMA' OR propuesta_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS ix_compromisos_territorio ON participacion.compromisos(territorio_id);
CREATE INDEX IF NOT EXISTS ix_compromisos_evento ON participacion.compromisos(evento_id);

-- A qué planteamientos responde cada compromiso (trazabilidad).
CREATE TABLE IF NOT EXISTS participacion.compromiso_necesidades (
    compromiso_id  uuid NOT NULL REFERENCES participacion.compromisos(id) ON DELETE CASCADE,
    necesidad_id   uuid NOT NULL REFERENCES participacion.necesidades(id) ON DELETE CASCADE,
    PRIMARY KEY (compromiso_id, necesidad_id)
);

DROP TRIGGER IF EXISTS trg_compromisos_fecha ON participacion.compromisos;
CREATE TRIGGER trg_compromisos_fecha BEFORE UPDATE ON participacion.compromisos
FOR EACH ROW EXECUTE FUNCTION util.fn_actualizar_fecha();

DROP TRIGGER IF EXISTS trg_compromisos_nivel ON participacion.compromisos;
CREATE TRIGGER trg_compromisos_nivel
BEFORE INSERT OR UPDATE OF territorio_id ON participacion.compromisos
FOR EACH ROW EXECUTE FUNCTION territorio.fn_exigir_nivel_municipal('territorio_id');

-- Auditoría
DROP TRIGGER IF EXISTS trg_audit_compromisos ON participacion.compromisos;
CREATE TRIGGER trg_audit_compromisos AFTER INSERT OR UPDATE OR DELETE ON participacion.compromisos
FOR EACH ROW EXECUTE FUNCTION auditoria.fn_registrar_cambio('id');
DROP TRIGGER IF EXISTS trg_audit_eventos ON eventos.eventos;
CREATE TRIGGER trg_audit_eventos AFTER INSERT OR UPDATE OR DELETE ON eventos.eventos
FOR EACH ROW EXECUTE FUNCTION auditoria.fn_registrar_cambio('id');
DROP TRIGGER IF EXISTS trg_audit_necesidades ON participacion.necesidades;
CREATE TRIGGER trg_audit_necesidades AFTER INSERT OR UPDATE OR DELETE ON participacion.necesidades
FOR EACH ROW EXECUTE FUNCTION auditoria.fn_registrar_cambio('id');

-- -----------------------------------------------------------------------------
-- 4. PERMISOS DE LA APLICACIÓN
-- -----------------------------------------------------------------------------
INSERT INTO acceso.permisos (codigo, descripcion) VALUES
    ('AGENDA_VER',        'Ver la agenda territorial, planteamientos y compromisos'),
    ('AGENDA_GESTIONAR',  'Registrar visitas, planteamientos y compromisos'),
    ('REPORTE_COMUNITARIO', 'Registrar reportes comunitarios de necesidades')
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO acceso.rol_permisos (rol_codigo, permiso_codigo) VALUES
    ('SUPERADMIN',  'AGENDA_VER'), ('SUPERADMIN', 'AGENDA_GESTIONAR'), ('SUPERADMIN', 'REPORTE_COMUNITARIO'),
    ('CANDIDATO',   'AGENDA_VER'),
    ('GERENTE',     'AGENDA_VER'), ('GERENTE', 'AGENDA_GESTIONAR'),
    ('COORDINADOR', 'AGENDA_VER'), ('COORDINADOR', 'AGENDA_GESTIONAR'), ('COORDINADOR', 'REPORTE_COMUNITARIO'),
    ('LIDER',       'REPORTE_COMUNITARIO')
ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------------------------
-- 5. SEGURIDAD POR FILA
--   Visitas y compromisos: se ven y se gestionan dentro del territorio visible
--   (el gerente y el candidato ven todo el departamento; un coordinador, su
--   municipio). Los líderes no ven la agenda.
--   Necesidades: además de lo existente, un líder ve y crea sus propios
--   reportes comunitarios.
-- -----------------------------------------------------------------------------
ALTER TABLE eventos.eventos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_eventos_territorio ON eventos.eventos;
CREATE POLICY p_eventos_territorio ON eventos.eventos
    USING (territorio_id IN (SELECT territorio_id FROM acceso.territorios_visibles()));

ALTER TABLE eventos.lideres_presentes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_lideres_presentes ON eventos.lideres_presentes;
CREATE POLICY p_lideres_presentes ON eventos.lideres_presentes
    USING (EXISTS (SELECT 1 FROM eventos.eventos e WHERE e.id = lideres_presentes.evento_id));

ALTER TABLE eventos.organizaciones_presentes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_organizaciones_presentes ON eventos.organizaciones_presentes;
CREATE POLICY p_organizaciones_presentes ON eventos.organizaciones_presentes
    USING (EXISTS (SELECT 1 FROM eventos.eventos e WHERE e.id = organizaciones_presentes.evento_id));

ALTER TABLE participacion.compromisos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_compromisos_territorio ON participacion.compromisos;
CREATE POLICY p_compromisos_territorio ON participacion.compromisos
    USING (territorio_id IN (SELECT territorio_id FROM acceso.territorios_visibles()));

ALTER TABLE participacion.compromiso_necesidades ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_compromiso_necesidades ON participacion.compromiso_necesidades;
CREATE POLICY p_compromiso_necesidades ON participacion.compromiso_necesidades
    USING (EXISTS (SELECT 1 FROM participacion.compromisos c WHERE c.id = compromiso_necesidades.compromiso_id));

DROP POLICY IF EXISTS p_necesidades_propias ON participacion.necesidades;
CREATE POLICY p_necesidades_propias ON participacion.necesidades
    USING (reportado_por = acceso.usuario_actual());

-- -----------------------------------------------------------------------------
-- 6. PRIVILEGIOS SOBRE LOS OBJETOS NUEVOS
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON
      eventos.lideres_presentes, eventos.organizaciones_presentes,
      participacion.compromisos, participacion.compromiso_necesidades
   TO rol_app;
GRANT SELECT ON eventos.tipos_organizacion TO rol_app, rol_reportes;
GRANT SELECT ON eventos.lideres_presentes, eventos.organizaciones_presentes,
      participacion.compromisos, participacion.compromiso_necesidades TO rol_reportes;

-- -----------------------------------------------------------------------------
-- 7. VISTAS
-- -----------------------------------------------------------------------------

-- Agenda: cada visita con su ubicación y lo que salió de ella.
CREATE OR REPLACE VIEW eventos.v_agenda WITH (security_invoker = true) AS
SELECT e.id,
       e.tipo_codigo,
       te.nombre AS tipo,
       e.nombre,
       e.estado,
       e.con_candidato,
       e.inicia_en,
       e.termina_en,
       e.territorio_id,
       t.nombre AS territorio,
       territorio.ancestro(e.territorio_id, 'MUNICIPIO') AS municipio_id,
       territorio.ruta(e.territorio_id) AS ruta,
       e.asistentes_aprox,
       e.resumen,
       ST_X(e.lugar) AS lon,
       ST_Y(e.lugar) AS lat,
       (SELECT count(*) FROM eventos.lideres_presentes lp WHERE lp.evento_id = e.id)        AS lideres_presentes,
       (SELECT count(*) FROM eventos.organizaciones_presentes op WHERE op.evento_id = e.id)  AS organizaciones,
       (SELECT count(*) FROM participacion.necesidades n WHERE n.evento_id = e.id)          AS planteamientos,
       (SELECT count(*) FROM participacion.compromisos c WHERE c.evento_id = e.id)          AS compromisos
  FROM eventos.eventos e
  JOIN eventos.tipos_evento te   ON te.codigo = e.tipo_codigo
  JOIN territorio.territorios t  ON t.id = e.territorio_id;

-- Cobertura: por cada territorio, visitas realizadas con el candidato
-- (sumando todo lo que está debajo) y la fecha de la última.
CREATE OR REPLACE VIEW eventos.v_cobertura WITH (security_invoker = true) AS
WITH RECURSIVE subida AS (
    SELECT e.id AS evento_id, e.inicia_en, t.id AS territorio_id, t.padre_id
      FROM eventos.eventos e
      JOIN territorio.territorios t ON t.id = e.territorio_id
     WHERE e.estado = 'REALIZADA' AND e.con_candidato
    UNION ALL
    SELECT s.evento_id, s.inicia_en, p.id, p.padre_id
      FROM subida s JOIN territorio.territorios p ON p.id = s.padre_id
)
SELECT t.id AS territorio_id,
       t.padre_id,
       t.tipo_codigo,
       t.nombre,
       count(DISTINCT s.evento_id)::integer AS visitas,
       max(s.inicia_en) AS ultima_visita,
       t.geom
  FROM territorio.territorios t
  LEFT JOIN subida s ON s.territorio_id = t.id
 GROUP BY t.id, t.padre_id, t.tipo_codigo, t.nombre, t.geom;

-- Compromisos con su contexto.
CREATE OR REPLACE VIEW participacion.v_compromisos WITH (security_invoker = true) AS
SELECT c.id,
       c.descripcion,
       c.estado,
       c.categoria_codigo,
       cn.nombre AS categoria,
       c.territorio_id,
       territorio.ruta(c.territorio_id) AS ruta,
       territorio.ancestro(c.territorio_id, 'MUNICIPIO') AS municipio_id,
       c.evento_id,
       e.nombre AS visita,
       e.inicia_en AS fecha_visita,
       c.propuesta_id,
       pr.titulo AS propuesta,
       c.responsable_miembro_id,
       c.creado_en,
       c.actualizada_en,
       (current_date - c.creado_en::date) AS dias_abierto,
       (SELECT count(*) FROM participacion.compromiso_necesidades x WHERE x.compromiso_id = c.id) AS planteamientos
  FROM participacion.compromisos c
  LEFT JOIN participacion.categorias_necesidad cn ON cn.codigo = c.categoria_codigo
  LEFT JOIN eventos.eventos e ON e.id = c.evento_id
  LEFT JOIN participacion.propuestas pr ON pr.id = c.propuesta_id;

GRANT SELECT ON eventos.v_agenda, eventos.v_cobertura, participacion.v_compromisos TO rol_app, rol_reportes;

-- Necesidades por municipio y categoría, ahora también por origen.
DROP VIEW IF EXISTS participacion.v_necesidades_origen;
CREATE VIEW participacion.v_necesidades_origen WITH (security_invoker = true) AS
SELECT territorio.ancestro(n.territorio_id, 'MUNICIPIO') AS municipio_id,
       coalesce(n.categoria_codigo,
                (SELECT c.categoria_codigo FROM participacion.clasificaciones_ia c
                  WHERE c.necesidad_id = n.id ORDER BY c.confianza DESC LIMIT 1),
                'OTRA') AS categoria_codigo,
       n.origen,
       count(*) AS cantidad
  FROM participacion.necesidades n
 GROUP BY 1, 2, 3;
GRANT SELECT ON participacion.v_necesidades_origen TO rol_app, rol_reportes;
