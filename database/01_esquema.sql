-- =============================================================================
--  PLATAFORMA DE CAMPAÑA – GOBERNACIÓN DEL CAQUETÁ
--  Base de datos normalizada hasta Cuarta Forma Normal (4FN)
--  Motor: PostgreSQL 16 + PostGIS 3 (probado en PostgreSQL 16.15 + PostGIS 3.4)
--
--  ORDEN DE INSTALACIÓN:
--    01_esquema.sql            tablas, llaves, restricciones, auditoría y catálogos
--    02_funciones.sql          funciones y procedimientos
--    03_triggers.sql           disparadores de reglas de negocio
--    04_vistas.sql             vistas de reportes, mapas y vista materializada
--    05_seguridad.sql          roles, permisos y seguridad por fila (RLS)
--    06_importar_gpkg.bat      importa caqueta.gpkg al esquema staging
--    07_carga_territorio.sql   carga departamento, municipios, veredas y puestos
--    08_datos_demo.sql         (opcional) datos ficticios para pruebas y demostración
--    09_consultas_utiles.sql   consultas de referencia para la API y reportes
--
--  Módulos cubiertos (según checklist de alcance):
--    1. Territorio y cartografía          -> esquema territorio
--    2. Personas y datos de contacto      -> esquema personas
--    3. Usuarios, roles y permisos        -> esquema acceso
--    4. Estructura de campaña y referidos -> esquema campana
--    5. Voz del territorio y programa     -> esquema participacion
--    6. Protección de datos (Ley 1581)    -> esquema cumplimiento
--    7. Calidad de datos                  -> esquema calidad
--    8. Eventos y asistencia              -> esquema eventos
--    9. Comunicaciones                    -> esquema comunicaciones
--   10. Chatbot                           -> esquema chatbot
--   11. Electoral y día D                 -> esquema electoral
--   12. Auditoría                         -> esquema auditoria
--
--  Decisión de arquitectura: una base de datos por campaña (single-tenant).
--  Cada campaña es un responsable distinto del tratamiento de datos; separar
--  bases evita que los datos de un cliente puedan cruzarse con los de otro.
--
--  Datos sensibles: documento y teléfono se guardan como
--    *_hash    -> HMAC-SHA256 calculado en la API con una clave secreta (pepper),
--                 sirve para buscar y detectar duplicados sin exponer el dato.
--    *_cifrado -> cifrado en la API (AES-256-GCM); la llave NO vive en la base.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;     -- correos sin distinguir mayúsculas

CREATE SCHEMA territorio;
CREATE SCHEMA electoral;
CREATE SCHEMA personas;
CREATE SCHEMA acceso;
CREATE SCHEMA campana;
CREATE SCHEMA participacion;
CREATE SCHEMA cumplimiento;
CREATE SCHEMA calidad;
CREATE SCHEMA eventos;
CREATE SCHEMA comunicaciones;
CREATE SCHEMA chatbot;
CREATE SCHEMA auditoria;


-- =============================================================================
-- 1. TERRITORIO
-- Jerarquía única y recursiva: departamento > municipio > comuna/corregimiento
-- > barrio/vereda/centro poblado. Cada territorio tiene UN solo padre, así el
-- municipio de un barrio nunca se repite en otra columna (evita dependencias
-- transitivas -> 3FN).
-- =============================================================================

CREATE TABLE territorio.tipos_territorio (
    codigo      text PRIMARY KEY,
    nombre      text NOT NULL,
    nivel       smallint NOT NULL CHECK (nivel BETWEEN 1 AND 4)
);

CREATE TABLE territorio.fuentes_geograficas (
    id               smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre           text NOT NULL UNIQUE,
    entidad          text NOT NULL,
    version          text,
    url              text,
    fecha_obtencion  date
);

CREATE TABLE territorio.territorios (
    id              integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tipo_codigo     text NOT NULL REFERENCES territorio.tipos_territorio(codigo),
    padre_id        integer REFERENCES territorio.territorios(id),
    codigo_oficial  text,                                  -- código DANE si existe
    nombre          text NOT NULL,
    geom            geometry(MultiPolygon, 4326),          -- opcional: veredas/barrios sin polígono
    fuente_id       smallint NOT NULL REFERENCES territorio.fuentes_geograficas(id),
    verificado      boolean NOT NULL DEFAULT false,
    creado_en       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_territorio_nombre UNIQUE (padre_id, tipo_codigo, nombre),
    CONSTRAINT uq_territorio_codigo UNIQUE (tipo_codigo, codigo_oficial),
    CONSTRAINT ck_territorio_raiz  CHECK ((padre_id IS NULL) = (tipo_codigo = 'DEPARTAMENTO'))
);
CREATE INDEX ix_territorios_padre ON territorio.territorios(padre_id);
CREATE INDEX ix_territorios_geom  ON territorio.territorios USING gist(geom);

-- Seudónimos de veredas/barrios ("La Y", "Kilómetro 5"...). Hecho multivaluado
-- independiente -> tabla propia (4FN).
CREATE TABLE territorio.nombres_alternos (
    territorio_id  integer NOT NULL REFERENCES territorio.territorios(id) ON DELETE CASCADE,
    nombre         text NOT NULL,
    PRIMARY KEY (territorio_id, nombre)
);

-- Un hijo siempre debe estar en un nivel más bajo que su padre.
CREATE FUNCTION territorio.fn_validar_jerarquia() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
    v_nivel_hijo  smallint;
    v_nivel_padre smallint;
BEGIN
    IF NEW.padre_id IS NULL THEN
        RETURN NEW;
    END IF;
    SELECT nivel INTO v_nivel_hijo
      FROM territorio.tipos_territorio WHERE codigo = NEW.tipo_codigo;
    SELECT tt.nivel INTO v_nivel_padre
      FROM territorio.territorios t
      JOIN territorio.tipos_territorio tt ON tt.codigo = t.tipo_codigo
     WHERE t.id = NEW.padre_id;
    IF v_nivel_hijo <= v_nivel_padre THEN
        RAISE EXCEPTION 'Un territorio de tipo % no puede depender de uno de nivel %',
            NEW.tipo_codigo, v_nivel_padre;
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_territorio_jerarquia
BEFORE INSERT OR UPDATE OF padre_id, tipo_codigo ON territorio.territorios
FOR EACH ROW EXECUTE FUNCTION territorio.fn_validar_jerarquia();

-- Todos los territorios debajo de uno dado (incluido él mismo).
CREATE FUNCTION territorio.descendientes(p_territorio_id integer)
RETURNS TABLE (territorio_id integer)
LANGUAGE sql STABLE AS $$
    WITH RECURSIVE arbol AS (
        SELECT t.id FROM territorio.territorios t WHERE t.id = p_territorio_id
        UNION ALL
        SELECT h.id FROM territorio.territorios h JOIN arbol a ON h.padre_id = a.id
    )
    SELECT id FROM arbol;
$$;

-- Ancestro de un tipo dado (ej.: el MUNICIPIO de una vereda).
CREATE FUNCTION territorio.ancestro(p_territorio_id integer, p_tipo text)
RETURNS integer
LANGUAGE sql STABLE AS $$
    WITH RECURSIVE subida AS (
        SELECT t.id, t.padre_id, t.tipo_codigo FROM territorio.territorios t
         WHERE t.id = p_territorio_id
        UNION ALL
        SELECT p.id, p.padre_id, p.tipo_codigo FROM territorio.territorios p
          JOIN subida s ON p.id = s.padre_id
    )
    SELECT id FROM subida WHERE tipo_codigo = p_tipo LIMIT 1;
$$;

-- Trigger reutilizable: exige que la columna indicada apunte a un territorio
-- de nivel municipio o inferior (nadie "vive" en el departamento entero).
CREATE FUNCTION territorio.fn_exigir_nivel_municipal() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
    v_id    integer := (to_jsonb(NEW) ->> TG_ARGV[0])::integer;
    v_nivel smallint;
BEGIN
    IF v_id IS NULL THEN
        RETURN NEW;
    END IF;
    SELECT tt.nivel INTO v_nivel
      FROM territorio.territorios t
      JOIN territorio.tipos_territorio tt ON tt.codigo = t.tipo_codigo
     WHERE t.id = v_id;
    IF v_nivel < 2 THEN
        RAISE EXCEPTION 'La columna % debe apuntar a un municipio o a un territorio inferior', TG_ARGV[0];
    END IF;
    RETURN NEW;
END $$;


-- =============================================================================
-- 2. ELECTORAL (catálogos, puestos y día D)
-- =============================================================================

CREATE TABLE electoral.tipos_jornada (
    codigo  text PRIMARY KEY,
    nombre  text NOT NULL
);

CREATE TABLE electoral.jornadas (
    id           smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre       text NOT NULL UNIQUE,              -- "Territoriales 2027"
    tipo_codigo  text NOT NULL REFERENCES electoral.tipos_jornada(codigo),
    fecha        date NOT NULL
);

CREATE TABLE electoral.corporaciones (
    codigo  text PRIMARY KEY,                       -- GOBERNACION, ASAMBLEA...
    nombre  text NOT NULL
);

CREATE TABLE electoral.puestos_votacion (
    id                    integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    territorio_id         integer NOT NULL REFERENCES territorio.territorios(id),
    codigo_registraduria  text UNIQUE,
    nombre                text NOT NULL,
    direccion             text,
    geom                  geometry(Point, 4326),
    CONSTRAINT uq_puesto_nombre UNIQUE (territorio_id, nombre)
);
CREATE INDEX ix_puestos_geom ON electoral.puestos_votacion USING gist(geom);
CREATE TRIGGER trg_puesto_nivel
BEFORE INSERT OR UPDATE OF territorio_id ON electoral.puestos_votacion
FOR EACH ROW EXECUTE FUNCTION territorio.fn_exigir_nivel_municipal('territorio_id');

-- Un puesto puede existir en 2023 y no en 2027 (o cambiar de potencial).
CREATE TABLE electoral.puestos_jornada (
    puesto_id            integer  NOT NULL REFERENCES electoral.puestos_votacion(id),
    jornada_id           smallint NOT NULL REFERENCES electoral.jornadas(id),
    potencial_electoral  integer CHECK (potencial_electoral >= 0),
    PRIMARY KEY (puesto_id, jornada_id)
);

-- Corporaciones que se votan en cada puesto y jornada. Es un hecho multivaluado
-- independiente de las mesas -> tabla aparte (4FN).
CREATE TABLE electoral.puestos_jornada_corporaciones (
    puesto_id           integer  NOT NULL,
    jornada_id          smallint NOT NULL,
    corporacion_codigo  text NOT NULL REFERENCES electoral.corporaciones(codigo),
    PRIMARY KEY (puesto_id, jornada_id, corporacion_codigo),
    FOREIGN KEY (puesto_id, jornada_id) REFERENCES electoral.puestos_jornada(puesto_id, jornada_id)
);

-- Mesas: solo para el módulo de testigos y resultados. El número de mesas de un
-- puesto se calcula contando filas (no se guarda en otra tabla).
CREATE TABLE electoral.mesas (
    id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    puesto_id   integer  NOT NULL,
    jornada_id  smallint NOT NULL,
    numero      smallint NOT NULL CHECK (numero > 0),
    CONSTRAINT uq_mesa UNIQUE (puesto_id, jornada_id, numero),
    FOREIGN KEY (puesto_id, jornada_id) REFERENCES electoral.puestos_jornada(puesto_id, jornada_id)
);

CREATE TABLE electoral.partidos (
    id      smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre  text NOT NULL UNIQUE
);

-- Candidatos + votos en blanco, nulos y no marcados, para registrar el E-14.
CREATE TABLE electoral.opciones_voto (
    id                  integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    jornada_id          smallint NOT NULL REFERENCES electoral.jornadas(id),
    corporacion_codigo  text NOT NULL REFERENCES electoral.corporaciones(codigo),
    tipo                text NOT NULL CHECK (tipo IN ('CANDIDATO','BLANCO','NULO','NO_MARCADO')),
    nombre              text NOT NULL,
    partido_id          smallint REFERENCES electoral.partidos(id),
    es_candidato_propio boolean NOT NULL DEFAULT false,
    CONSTRAINT uq_opcion UNIQUE (jornada_id, corporacion_codigo, nombre),
    CONSTRAINT ck_opcion_partido CHECK (tipo = 'CANDIDATO' OR partido_id IS NULL)
);


-- =============================================================================
-- 3. PERSONAS
-- Una sola tabla de personas para simpatizantes, líderes, usuarios y testigos:
-- el nombre de alguien se guarda una vez, aunque cumpla varios papeles.
-- =============================================================================

CREATE TABLE personas.tipos_documento (
    codigo  text PRIMARY KEY,
    nombre  text NOT NULL
);

CREATE TABLE personas.personas (
    id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tipo_documento_codigo  text  NOT NULL REFERENCES personas.tipos_documento(codigo),
    documento_hash         bytea NOT NULL,
    documento_cifrado      bytea NOT NULL,
    nombres                text  NOT NULL,
    apellidos              text  NOT NULL,
    creado_en              timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_persona_documento UNIQUE (tipo_documento_codigo, documento_hash)
);

-- Varios teléfonos por persona: hecho multivaluado independiente (4FN).
CREATE TABLE personas.telefonos (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    persona_id        uuid  NOT NULL REFERENCES personas.personas(id) ON DELETE CASCADE,
    telefono_hash     bytea NOT NULL,
    telefono_cifrado  bytea NOT NULL,
    es_principal      boolean NOT NULL DEFAULT false,
    CONSTRAINT uq_telefono_persona UNIQUE (persona_id, telefono_hash)
);
CREATE UNIQUE INDEX uq_telefono_principal ON personas.telefonos(persona_id) WHERE es_principal;
CREATE INDEX ix_telefonos_hash ON personas.telefonos(telefono_hash);   -- detectar teléfonos repetidos

-- Varios correos por persona (4FN, independiente de los teléfonos).
CREATE TABLE personas.correos (
    persona_id    uuid   NOT NULL REFERENCES personas.personas(id) ON DELETE CASCADE,
    correo        citext NOT NULL,
    es_principal  boolean NOT NULL DEFAULT false,
    verificado    boolean NOT NULL DEFAULT false,
    PRIMARY KEY (persona_id, correo)
);
CREATE UNIQUE INDEX uq_correo_principal ON personas.correos(persona_id) WHERE es_principal;


-- =============================================================================
-- 4. ACCESO (usuarios del sistema, roles, permisos y territorio visible)
-- =============================================================================

CREATE TABLE acceso.usuarios (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    persona_id     uuid   NOT NULL UNIQUE REFERENCES personas.personas(id),
    login          citext NOT NULL UNIQUE,
    password_hash  text   NOT NULL,          -- argon2id/bcrypt; o delegar al proveedor de autenticación
    activo         boolean NOT NULL DEFAULT true,
    creado_en      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE acceso.factores_mfa (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id       uuid NOT NULL REFERENCES acceso.usuarios(id) ON DELETE CASCADE,
    tipo             text NOT NULL CHECK (tipo IN ('TOTP','WEBAUTHN')),
    secreto_cifrado  bytea NOT NULL,
    creado_en        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_factor UNIQUE (usuario_id, tipo)
);

CREATE TABLE acceso.sesiones (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id   uuid NOT NULL REFERENCES acceso.usuarios(id) ON DELETE CASCADE,
    iniciada_en  timestamptz NOT NULL DEFAULT now(),
    cerrada_en   timestamptz,
    ip           inet,
    user_agent   text,
    CONSTRAINT ck_sesion_fechas CHECK (cerrada_en IS NULL OR cerrada_en >= iniciada_en)
);

CREATE TABLE acceso.roles (
    codigo       text PRIMARY KEY,
    nombre       text NOT NULL,
    descripcion  text
);

CREATE TABLE acceso.permisos (
    codigo       text PRIMARY KEY,
    descripcion  text NOT NULL
);

CREATE TABLE acceso.rol_permisos (
    rol_codigo      text NOT NULL REFERENCES acceso.roles(codigo) ON DELETE CASCADE,
    permiso_codigo  text NOT NULL REFERENCES acceso.permisos(codigo) ON DELETE CASCADE,
    PRIMARY KEY (rol_codigo, permiso_codigo)
);

-- Ejemplo clásico de 4FN: los roles de un usuario y los territorios que puede
-- ver son hechos multivaluados INDEPENDIENTES. En una sola tabla
-- (usuario, rol, territorio) habría que repetir cada rol por cada territorio.
CREATE TABLE acceso.usuario_roles (
    usuario_id  uuid NOT NULL REFERENCES acceso.usuarios(id) ON DELETE CASCADE,
    rol_codigo  text NOT NULL REFERENCES acceso.roles(codigo),
    PRIMARY KEY (usuario_id, rol_codigo)
);

CREATE TABLE acceso.usuario_territorios (
    usuario_id     uuid    NOT NULL REFERENCES acceso.usuarios(id) ON DELETE CASCADE,
    territorio_id  integer NOT NULL REFERENCES territorio.territorios(id),
    PRIMARY KEY (usuario_id, territorio_id)
);


-- =============================================================================
-- 5. CAMPAÑA (estructura organizativa, referidos, metas y simpatizantes)
-- Un miembro de la estructura (coordinador, líder) no siempre usa el sistema:
-- por eso "miembro" y "usuario" son conceptos distintos que apuntan a persona.
-- =============================================================================

CREATE TABLE campana.cargos (
    codigo  text PRIMARY KEY,
    nombre  text NOT NULL,
    nivel   smallint NOT NULL CHECK (nivel > 0)     -- 1 = gerente ... 4 = sublíder
);

CREATE TABLE campana.miembros (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    persona_id      uuid NOT NULL UNIQUE REFERENCES personas.personas(id),
    cargo_codigo    text NOT NULL REFERENCES campana.cargos(codigo),
    superior_id     uuid REFERENCES campana.miembros(id),
    fecha_ingreso   date NOT NULL DEFAULT current_date,
    activo          boolean NOT NULL DEFAULT true,
    CONSTRAINT ck_miembro_no_autosuperior CHECK (superior_id <> id)
);
CREATE INDEX ix_miembros_superior ON campana.miembros(superior_id);

-- Zonas de trabajo de cada miembro (multivaluado, independiente del cargo).
CREATE TABLE campana.miembro_territorios (
    miembro_id     uuid    NOT NULL REFERENCES campana.miembros(id) ON DELETE CASCADE,
    territorio_id  integer NOT NULL REFERENCES territorio.territorios(id),
    PRIMARY KEY (miembro_id, territorio_id)
);

-- Todos los miembros debajo de uno (incluido él mismo).
CREATE FUNCTION campana.subordinados(p_miembro_id uuid)
RETURNS TABLE (miembro_id uuid)
LANGUAGE sql STABLE AS $$
    WITH RECURSIVE red AS (
        SELECT m.id FROM campana.miembros m WHERE m.id = p_miembro_id
        UNION ALL
        SELECT h.id FROM campana.miembros h JOIN red r ON h.superior_id = r.id
    )
    SELECT id FROM red;
$$;

-- Cada miembro tiene al menos un link principal. Los registros hechos por un
-- digitador usan el link principal del líder: así el "quién refirió" se deriva
-- siempre del link y nunca se guarda dos veces (3FN).
CREATE TABLE campana.links_referido (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    miembro_id    uuid NOT NULL REFERENCES campana.miembros(id),
    codigo        text NOT NULL UNIQUE CHECK (length(codigo) >= 6),
    es_principal  boolean NOT NULL DEFAULT false,
    activo        boolean NOT NULL DEFAULT true,
    creado_en     timestamptz NOT NULL DEFAULT now(),
    expira_en     timestamptz
);
CREATE UNIQUE INDEX uq_link_principal ON campana.links_referido(miembro_id) WHERE es_principal;

-- Metas por miembro y por territorio en tablas separadas: evita una tabla con
-- dos claves foráneas excluyentes y columnas nulas.
CREATE TABLE campana.metas_miembro (
    id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    miembro_id    uuid NOT NULL REFERENCES campana.miembros(id) ON DELETE CASCADE,
    cantidad      integer NOT NULL CHECK (cantidad > 0),
    fecha_inicio  date NOT NULL,
    fecha_limite  date NOT NULL,
    CONSTRAINT uq_meta_miembro UNIQUE (miembro_id, fecha_limite),
    CONSTRAINT ck_meta_miembro_fechas CHECK (fecha_limite >= fecha_inicio)
);

CREATE TABLE campana.metas_territorio (
    id             integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    territorio_id  integer NOT NULL REFERENCES territorio.territorios(id),
    cantidad       integer NOT NULL CHECK (cantidad > 0),
    fecha_inicio   date NOT NULL,
    fecha_limite   date NOT NULL,
    CONSTRAINT uq_meta_territorio UNIQUE (territorio_id, fecha_limite),
    CONSTRAINT ck_meta_territorio_fechas CHECK (fecha_limite >= fecha_inicio)
);

CREATE TABLE campana.canales_registro (
    codigo  text PRIMARY KEY,           -- FORMULARIO_WEB, CHATBOT_WEB, TELEGRAM, DIGITADOR, EVENTO
    nombre  text NOT NULL
);

CREATE TABLE campana.estados_simpatizante (
    codigo  text PRIMARY KEY,           -- ACTIVO, EN_REVISION, RETIRADO
    nombre  text NOT NULL
);

CREATE TABLE campana.simpatizantes (
    persona_id                uuid PRIMARY KEY REFERENCES personas.personas(id) ON DELETE CASCADE,
    territorio_residencia_id  integer NOT NULL REFERENCES territorio.territorios(id),
    ubicacion                 geometry(Point, 4326),        -- opcional y con autorización
    link_referido_id          uuid NOT NULL REFERENCES campana.links_referido(id),
    canal_codigo              text NOT NULL REFERENCES campana.canales_registro(codigo),
    registrado_por            uuid REFERENCES acceso.usuarios(id),   -- NULL = autorregistro
    estado_codigo             text NOT NULL DEFAULT 'ACTIVO' REFERENCES campana.estados_simpatizante(codigo),
    capturado_en              timestamptz NOT NULL,          -- hora en el dispositivo (modo offline)
    recibido_en               timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_simpatizante_fechas CHECK (recibido_en >= capturado_en - interval '5 minutes')
);
CREATE INDEX ix_simpatizantes_territorio ON campana.simpatizantes(territorio_residencia_id);
CREATE INDEX ix_simpatizantes_link       ON campana.simpatizantes(link_referido_id);
CREATE INDEX ix_simpatizantes_ubicacion  ON campana.simpatizantes USING gist(ubicacion);
CREATE TRIGGER trg_simpatizante_nivel
BEFORE INSERT OR UPDATE OF territorio_residencia_id ON campana.simpatizantes
FOR EACH ROW EXECUTE FUNCTION territorio.fn_exigir_nivel_municipal('territorio_residencia_id');

-- Puesto donde vota cada simpatizante, por jornada (puede cambiar entre 2023 y 2027).
CREATE TABLE campana.simpatizante_puesto (
    persona_id     uuid     NOT NULL REFERENCES campana.simpatizantes(persona_id) ON DELETE CASCADE,
    jornada_id     smallint NOT NULL,
    puesto_id      integer  NOT NULL,
    fuente         text NOT NULL DEFAULT 'AUTODECLARADO'
                   CHECK (fuente IN ('AUTODECLARADO','VERIFICADO_COORDINADOR')),
    registrado_en  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (persona_id, jornada_id),
    FOREIGN KEY (puesto_id, jornada_id) REFERENCES electoral.puestos_jornada(puesto_id, jornada_id)
);
CREATE INDEX ix_simpatizante_puesto ON campana.simpatizante_puesto(puesto_id, jornada_id);


-- =============================================================================
-- 6. PARTICIPACIÓN (voz del territorio y programa de gobierno)
-- =============================================================================

CREATE TABLE participacion.categorias_necesidad (
    codigo  text PRIMARY KEY,
    nombre  text NOT NULL
);

-- La necesidad se conserva aunque la persona pida ser eliminada (queda anónima):
-- sigue siendo útil para el programa de gobierno sin datos personales.
CREATE TABLE participacion.necesidades (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    persona_id        uuid REFERENCES personas.personas(id) ON DELETE SET NULL,
    territorio_id     integer NOT NULL REFERENCES territorio.territorios(id),
    descripcion       text NOT NULL,
    categoria_codigo  text REFERENCES participacion.categorias_necesidad(codigo),  -- asignada por una persona
    reportada_en      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_necesidades_territorio ON participacion.necesidades(territorio_id);

-- Sugerencias de la IA, separadas de la clasificación humana.
CREATE TABLE participacion.clasificaciones_ia (
    necesidad_id      uuid NOT NULL REFERENCES participacion.necesidades(id) ON DELETE CASCADE,
    categoria_codigo  text NOT NULL REFERENCES participacion.categorias_necesidad(codigo),
    modelo            text NOT NULL,
    confianza         numeric(4,3) NOT NULL CHECK (confianza BETWEEN 0 AND 1),
    clasificada_en    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (necesidad_id, modelo, categoria_codigo)
);

CREATE TABLE participacion.ejes_programa (
    codigo  text PRIMARY KEY,
    nombre  text NOT NULL,
    orden   smallint NOT NULL UNIQUE
);

CREATE TABLE participacion.propuestas (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    eje_codigo      text NOT NULL REFERENCES participacion.ejes_programa(codigo),
    titulo          text NOT NULL,
    contenido       text NOT NULL,
    publicada       boolean NOT NULL DEFAULT false,
    actualizada_en  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_propuesta UNIQUE (eje_codigo, titulo)
);

-- Territorios a los que apunta una propuesta y necesidades que atiende:
-- dos hechos multivaluados independientes -> dos tablas (4FN).
CREATE TABLE participacion.propuesta_territorios (
    propuesta_id   uuid    NOT NULL REFERENCES participacion.propuestas(id) ON DELETE CASCADE,
    territorio_id  integer NOT NULL REFERENCES territorio.territorios(id),
    PRIMARY KEY (propuesta_id, territorio_id)
);

CREATE TABLE participacion.propuesta_categorias (
    propuesta_id      uuid NOT NULL REFERENCES participacion.propuestas(id) ON DELETE CASCADE,
    categoria_codigo  text NOT NULL REFERENCES participacion.categorias_necesidad(codigo),
    PRIMARY KEY (propuesta_id, categoria_codigo)
);


-- =============================================================================
-- 7. CUMPLIMIENTO – LEY 1581 DE 2012
-- =============================================================================

CREATE TABLE cumplimiento.politicas_tratamiento (
    version        smallint PRIMARY KEY,
    texto          text  NOT NULL,
    hash_texto     bytea NOT NULL,          -- prueba de qué texto exacto se aceptó
    vigente_desde  date  NOT NULL,
    vigente_hasta  date,
    CONSTRAINT ck_politica_fechas CHECK (vigente_hasta IS NULL OR vigente_hasta >= vigente_desde)
);

CREATE TABLE cumplimiento.finalidades (
    codigo       text PRIMARY KEY,          -- ORGANIZACION_CAMPANA, COMUNICACIONES, EVENTOS...
    descripcion  text NOT NULL
);

CREATE TABLE cumplimiento.politica_finalidades (
    politica_version  smallint NOT NULL REFERENCES cumplimiento.politicas_tratamiento(version),
    finalidad_codigo  text NOT NULL REFERENCES cumplimiento.finalidades(codigo),
    PRIMARY KEY (politica_version, finalidad_codigo)
);

CREATE TABLE cumplimiento.autorizaciones (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    persona_id        uuid NOT NULL REFERENCES personas.personas(id) ON DELETE CASCADE,
    politica_version  smallint NOT NULL REFERENCES cumplimiento.politicas_tratamiento(version),
    canal_codigo      text NOT NULL REFERENCES campana.canales_registro(codigo),
    evidencia         text NOT NULL,        -- 'casilla marcada', 'firma en planilla #', ...
    ip                inet,
    user_agent        text,
    otorgada_en       timestamptz NOT NULL DEFAULT now(),
    revocada_en       timestamptz,
    CONSTRAINT ck_autorizacion_fechas CHECK (revocada_en IS NULL OR revocada_en >= otorgada_en)
);
CREATE INDEX ix_autorizaciones_persona ON cumplimiento.autorizaciones(persona_id);

-- Autorización por finalidad: aceptar la campaña no implica aceptar mensajes.
CREATE TABLE cumplimiento.autorizacion_finalidades (
    autorizacion_id   uuid NOT NULL REFERENCES cumplimiento.autorizaciones(id) ON DELETE CASCADE,
    finalidad_codigo  text NOT NULL REFERENCES cumplimiento.finalidades(codigo),
    PRIMARY KEY (autorizacion_id, finalidad_codigo)
);

-- Solo se puede autorizar una finalidad incluida en la política que se aceptó.
CREATE FUNCTION cumplimiento.fn_validar_finalidad() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM cumplimiento.autorizaciones a
          JOIN cumplimiento.politica_finalidades pf ON pf.politica_version = a.politica_version
         WHERE a.id = NEW.autorizacion_id AND pf.finalidad_codigo = NEW.finalidad_codigo
    ) THEN
        RAISE EXCEPTION 'La finalidad % no hace parte de la política aceptada', NEW.finalidad_codigo;
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_validar_finalidad
BEFORE INSERT OR UPDATE ON cumplimiento.autorizacion_finalidades
FOR EACH ROW EXECUTE FUNCTION cumplimiento.fn_validar_finalidad();

CREATE TABLE cumplimiento.tipos_solicitud (
    codigo              text PRIMARY KEY,  -- CONSULTA, ACTUALIZACION, SUPRESION, REVOCATORIA
    nombre              text NOT NULL,
    plazo_dias_habiles  smallint NOT NULL CHECK (plazo_dias_habiles > 0)
);

CREATE TABLE cumplimiento.solicitudes_titular (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    radicado            text NOT NULL UNIQUE,
    persona_id          uuid REFERENCES personas.personas(id) ON DELETE SET NULL,
    tipo_codigo         text NOT NULL REFERENCES cumplimiento.tipos_solicitud(codigo),
    contacto_respuesta  text NOT NULL,      -- correo o dirección para responder
    descripcion         text NOT NULL,
    recibida_en         timestamptz NOT NULL DEFAULT now(),
    estado              text NOT NULL DEFAULT 'RECIBIDA'
                        CHECK (estado IN ('RECIBIDA','EN_TRAMITE','RESPONDIDA','RECHAZADA')),
    respondida_en       timestamptz,
    respuesta           text,
    CONSTRAINT ck_solicitud_respuesta CHECK (
        (estado IN ('RESPONDIDA','RECHAZADA')) = (respondida_en IS NOT NULL))
);


-- =============================================================================
-- 8. CALIDAD DE DATOS
-- =============================================================================

-- Cada vez que alguien intenta registrar una cédula que ya existe.
CREATE TABLE calidad.intentos_duplicado (
    id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    persona_existente_id uuid NOT NULL REFERENCES personas.personas(id) ON DELETE CASCADE,
    link_referido_id     uuid NOT NULL REFERENCES campana.links_referido(id),
    canal_codigo         text NOT NULL REFERENCES campana.canales_registro(codigo),
    intentado_en         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_intentos_link ON calidad.intentos_duplicado(link_referido_id);

CREATE TABLE calidad.tipos_alerta (
    codigo       text PRIMARY KEY,   -- DUPLICADO_ENTRE_LIDERES, TELEFONO_REPETIDO, REGISTRO_MASIVO...
    descripcion  text NOT NULL,
    severidad    text NOT NULL CHECK (severidad IN ('BAJA','MEDIA','ALTA'))
);

CREATE TABLE calidad.alertas (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tipo_codigo   text NOT NULL REFERENCES calidad.tipos_alerta(codigo),
    detectada_en  timestamptz NOT NULL DEFAULT now(),
    estado        text NOT NULL DEFAULT 'ABIERTA'
                  CHECK (estado IN ('ABIERTA','EN_REVISION','RESUELTA','DESCARTADA')),
    resuelta_por  uuid REFERENCES acceso.usuarios(id),
    resuelta_en   timestamptz,
    observacion   text,
    CONSTRAINT ck_alerta_resolucion CHECK (
        (estado IN ('RESUELTA','DESCARTADA')) = (resuelta_en IS NOT NULL AND resuelta_por IS NOT NULL))
);

-- Personas y miembros involucrados en una alerta: independientes entre sí (4FN).
CREATE TABLE calidad.alerta_personas (
    alerta_id   uuid NOT NULL REFERENCES calidad.alertas(id) ON DELETE CASCADE,
    persona_id  uuid NOT NULL REFERENCES personas.personas(id) ON DELETE CASCADE,
    PRIMARY KEY (alerta_id, persona_id)
);

CREATE TABLE calidad.alerta_miembros (
    alerta_id   uuid NOT NULL REFERENCES calidad.alertas(id) ON DELETE CASCADE,
    miembro_id  uuid NOT NULL REFERENCES campana.miembros(id) ON DELETE CASCADE,
    PRIMARY KEY (alerta_id, miembro_id)
);


-- =============================================================================
-- 9. EVENTOS
-- =============================================================================

CREATE TABLE eventos.tipos_evento (
    codigo  text PRIMARY KEY,       -- REUNION, FORO, CARAVANA, VISITA_VEREDAL
    nombre  text NOT NULL
);

CREATE TABLE eventos.eventos (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tipo_codigo     text NOT NULL REFERENCES eventos.tipos_evento(codigo),
    nombre          text NOT NULL,
    descripcion     text,
    territorio_id   integer NOT NULL REFERENCES territorio.territorios(id),
    lugar           geometry(Point, 4326),
    inicia_en       timestamptz NOT NULL,
    termina_en      timestamptz NOT NULL,
    codigo_checkin  text NOT NULL UNIQUE,
    creado_por      uuid NOT NULL REFERENCES acceso.usuarios(id),
    CONSTRAINT ck_evento_fechas CHECK (termina_en >= inicia_en)
);
CREATE INDEX ix_eventos_territorio ON eventos.eventos(territorio_id);

CREATE TABLE eventos.organizadores (
    evento_id   uuid NOT NULL REFERENCES eventos.eventos(id) ON DELETE CASCADE,
    miembro_id  uuid NOT NULL REFERENCES campana.miembros(id),
    PRIMARY KEY (evento_id, miembro_id)
);

CREATE TABLE eventos.asistencias (
    evento_id      uuid NOT NULL REFERENCES eventos.eventos(id) ON DELETE CASCADE,
    persona_id     uuid NOT NULL REFERENCES personas.personas(id) ON DELETE CASCADE,
    metodo         text NOT NULL CHECK (metodo IN ('QR','MANUAL')),
    registrada_en  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (evento_id, persona_id)
);


-- =============================================================================
-- 10. COMUNICACIONES (solo a personas con autorización para esa finalidad)
-- =============================================================================

CREATE TABLE comunicaciones.canales (
    codigo  text PRIMARY KEY,       -- SMS, EMAIL, TELEGRAM, PUSH
    nombre  text NOT NULL
);

CREATE TABLE comunicaciones.bajas (
    persona_id     uuid NOT NULL REFERENCES personas.personas(id) ON DELETE CASCADE,
    canal_codigo   text NOT NULL REFERENCES comunicaciones.canales(codigo),
    solicitada_en  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (persona_id, canal_codigo)
);

CREATE TABLE comunicaciones.plantillas (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre        text NOT NULL UNIQUE,
    canal_codigo  text NOT NULL REFERENCES comunicaciones.canales(codigo),
    contenido     text NOT NULL,
    aprobada_por  uuid REFERENCES acceso.usuarios(id),
    aprobada_en   timestamptz,
    CONSTRAINT ck_plantilla_aprobacion CHECK ((aprobada_por IS NULL) = (aprobada_en IS NULL))
);

CREATE TABLE comunicaciones.envios (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    plantilla_id     uuid NOT NULL REFERENCES comunicaciones.plantillas(id),
    creado_por       uuid NOT NULL REFERENCES acceso.usuarios(id),
    programado_para  timestamptz NOT NULL,
    estado           text NOT NULL DEFAULT 'BORRADOR'
                     CHECK (estado IN ('BORRADOR','PROGRAMADO','EN_CURSO','TERMINADO','CANCELADO'))
);

-- Segmentación del envío por territorio (multivaluado).
CREATE TABLE comunicaciones.envio_territorios (
    envio_id       uuid    NOT NULL REFERENCES comunicaciones.envios(id) ON DELETE CASCADE,
    territorio_id  integer NOT NULL REFERENCES territorio.territorios(id),
    PRIMARY KEY (envio_id, territorio_id)
);

CREATE TABLE comunicaciones.envio_destinatarios (
    envio_id      uuid NOT NULL REFERENCES comunicaciones.envios(id) ON DELETE CASCADE,
    persona_id    uuid NOT NULL REFERENCES personas.personas(id) ON DELETE CASCADE,
    estado        text NOT NULL DEFAULT 'PENDIENTE'
                  CHECK (estado IN ('PENDIENTE','ENVIADO','FALLIDO','OMITIDO_SIN_AUTORIZACION')),
    procesado_en  timestamptz,
    error         text,
    PRIMARY KEY (envio_id, persona_id)
);

-- Notificaciones internas de la app para líderes y coordinadores.
CREATE TABLE comunicaciones.notificaciones (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id  uuid NOT NULL REFERENCES acceso.usuarios(id) ON DELETE CASCADE,
    titulo      text NOT NULL,
    cuerpo      text NOT NULL,
    creada_en   timestamptz NOT NULL DEFAULT now(),
    leida_en    timestamptz
);
CREATE INDEX ix_notificaciones_pendientes ON comunicaciones.notificaciones(usuario_id) WHERE leida_en IS NULL;


-- =============================================================================
-- 11. CHATBOT (web y Telegram; NO WhatsApp automatizado)
-- Retención sugerida: borrar mensajes con más de 90 días.
-- =============================================================================

CREATE TABLE chatbot.conversaciones (
    id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    canal_codigo                text NOT NULL REFERENCES campana.canales_registro(codigo),
    link_referido_id            uuid REFERENCES campana.links_referido(id),
    persona_id                  uuid REFERENCES personas.personas(id) ON DELETE SET NULL,
    identificador_externo_hash  bytea,              -- id de Telegram, hasheado
    iniciada_en                 timestamptz NOT NULL DEFAULT now(),
    finalizada_en               timestamptz,
    resultado                   text CHECK (resultado IN ('REGISTRO_COMPLETO','ABANDONADA','SOLO_CONSULTA'))
);

CREATE TABLE chatbot.mensajes (
    id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    conversacion_id  uuid NOT NULL REFERENCES chatbot.conversaciones(id) ON DELETE CASCADE,
    emisor           text NOT NULL CHECK (emisor IN ('USUARIO','BOT')),
    contenido        text NOT NULL,
    enviado_en       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_mensajes_conversacion ON chatbot.mensajes(conversacion_id, enviado_en);


-- =============================================================================
-- 12. DÍA D: TESTIGOS Y FORMULARIOS E-14
-- =============================================================================

CREATE TABLE electoral.testigos (
    mesa_id      integer NOT NULL REFERENCES electoral.mesas(id),
    miembro_id   uuid    NOT NULL REFERENCES campana.miembros(id),
    estado       text NOT NULL DEFAULT 'ASIGNADO'
                 CHECK (estado IN ('ASIGNADO','CONFIRMADO','PRESENTE','AUSENTE')),
    asignado_en  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (mesa_id, miembro_id)
);

CREATE TABLE electoral.formularios_e14 (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    mesa_id             integer NOT NULL REFERENCES electoral.mesas(id),
    corporacion_codigo  text NOT NULL REFERENCES electoral.corporaciones(codigo),
    archivo_ruta        text  NOT NULL,
    archivo_sha256      bytea NOT NULL,
    cargado_por         uuid NOT NULL REFERENCES acceso.usuarios(id),
    cargado_en          timestamptz NOT NULL DEFAULT now(),
    estado_revision     text NOT NULL DEFAULT 'PENDIENTE'
                        CHECK (estado_revision IN ('PENDIENTE','VALIDADO','CON_INCONSISTENCIAS')),
    CONSTRAINT uq_e14_archivo UNIQUE (mesa_id, corporacion_codigo, archivo_sha256)
);

CREATE TABLE electoral.resultados_e14 (
    formulario_id   uuid    NOT NULL REFERENCES electoral.formularios_e14(id) ON DELETE CASCADE,
    opcion_voto_id  integer NOT NULL REFERENCES electoral.opciones_voto(id),
    votos           integer NOT NULL CHECK (votos >= 0),
    PRIMARY KEY (formulario_id, opcion_voto_id)
);


-- =============================================================================
-- 13. AUDITORÍA (solo inserción; nunca se edita ni se borra)
-- Guarda QUÉ campos cambiaron, no sus valores, para no duplicar datos personales.
-- =============================================================================

CREATE TABLE auditoria.eventos (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    usuario_id   uuid REFERENCES acceso.usuarios(id) ON DELETE SET NULL,
    accion       text NOT NULL CHECK (accion IN
                 ('INSERT','UPDATE','DELETE','CONSULTA','EXPORTACION','LOGIN','LOGIN_FALLIDO')),
    esquema      text,
    tabla        text,
    registro_id  text,
    ip           inet,
    ocurrido_en  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_auditoria_usuario ON auditoria.eventos(usuario_id, ocurrido_en);
CREATE INDEX ix_auditoria_registro ON auditoria.eventos(esquema, tabla, registro_id);

-- Campos modificados: tabla aparte en lugar de un arreglo (1FN estricta).
CREATE TABLE auditoria.evento_campos (
    evento_id  bigint NOT NULL REFERENCES auditoria.eventos(id),
    campo      text   NOT NULL,
    PRIMARY KEY (evento_id, campo)
);

CREATE TABLE auditoria.exportaciones (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    usuario_id          uuid NOT NULL REFERENCES acceso.usuarios(id),
    motivo              text NOT NULL,
    formato             text NOT NULL CHECK (formato IN ('XLSX','CSV','PDF')),
    cantidad_registros  integer NOT NULL CHECK (cantidad_registros >= 0),
    exportado_en        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE auditoria.exportacion_territorios (
    exportacion_id  bigint  NOT NULL REFERENCES auditoria.exportaciones(id),
    territorio_id   integer NOT NULL REFERENCES territorio.territorios(id),
    PRIMARY KEY (exportacion_id, territorio_id)
);

-- Impide modificar o borrar la bitácora.
CREATE FUNCTION auditoria.fn_solo_insercion() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'La tabla de auditoría % no admite %', TG_TABLE_NAME, TG_OP;
END $$;

CREATE TRIGGER trg_auditoria_inmutable BEFORE UPDATE OR DELETE ON auditoria.eventos
FOR EACH ROW EXECUTE FUNCTION auditoria.fn_solo_insercion();
CREATE TRIGGER trg_campos_inmutable BEFORE UPDATE OR DELETE ON auditoria.evento_campos
FOR EACH ROW EXECUTE FUNCTION auditoria.fn_solo_insercion();
CREATE TRIGGER trg_exportaciones_inmutable BEFORE UPDATE OR DELETE ON auditoria.exportaciones
FOR EACH ROW EXECUTE FUNCTION auditoria.fn_solo_insercion();

-- Usuario de la aplicación: la API ejecuta al inicio de cada transacción
--   SET LOCAL app.usuario_id = '<uuid>';
CREATE FUNCTION acceso.usuario_actual() RETURNS uuid
LANGUAGE sql STABLE AS $$
    SELECT nullif(current_setting('app.usuario_id', true), '')::uuid;
$$;

-- Trigger genérico de auditoría para tablas con datos personales.
CREATE FUNCTION auditoria.fn_registrar_cambio() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
    v_evento_id bigint;
    v_fila      jsonb := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
    v_llave     text  := TG_ARGV[0];
BEGIN
    INSERT INTO auditoria.eventos (usuario_id, accion, esquema, tabla, registro_id, ip)
    VALUES (acceso.usuario_actual(), TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME,
            v_fila ->> v_llave, inet_client_addr())
    RETURNING id INTO v_evento_id;

    IF TG_OP = 'UPDATE' THEN
        INSERT INTO auditoria.evento_campos (evento_id, campo)
        SELECT v_evento_id, n.key
          FROM jsonb_each(to_jsonb(NEW)) n
          JOIN jsonb_each(to_jsonb(OLD)) o USING (key)
         WHERE n.value IS DISTINCT FROM o.value;
    END IF;
    RETURN NULL;
END $$;

CREATE TRIGGER trg_audit_personas AFTER INSERT OR UPDATE OR DELETE ON personas.personas
FOR EACH ROW EXECUTE FUNCTION auditoria.fn_registrar_cambio('id');
CREATE TRIGGER trg_audit_telefonos AFTER INSERT OR UPDATE OR DELETE ON personas.telefonos
FOR EACH ROW EXECUTE FUNCTION auditoria.fn_registrar_cambio('id');
CREATE TRIGGER trg_audit_simpatizantes AFTER INSERT OR UPDATE OR DELETE ON campana.simpatizantes
FOR EACH ROW EXECUTE FUNCTION auditoria.fn_registrar_cambio('persona_id');
CREATE TRIGGER trg_audit_miembros AFTER INSERT OR UPDATE OR DELETE ON campana.miembros
FOR EACH ROW EXECUTE FUNCTION auditoria.fn_registrar_cambio('id');
CREATE TRIGGER trg_audit_usuario_roles AFTER INSERT OR UPDATE OR DELETE ON acceso.usuario_roles
FOR EACH ROW EXECUTE FUNCTION auditoria.fn_registrar_cambio('usuario_id');
CREATE TRIGGER trg_audit_usuario_territorios AFTER INSERT OR UPDATE OR DELETE ON acceso.usuario_territorios
FOR EACH ROW EXECUTE FUNCTION auditoria.fn_registrar_cambio('usuario_id');
CREATE TRIGGER trg_audit_autorizaciones AFTER INSERT OR UPDATE OR DELETE ON cumplimiento.autorizaciones
FOR EACH ROW EXECUTE FUNCTION auditoria.fn_registrar_cambio('id');



-- =============================================================================
-- PARÁMETROS DEL SISTEMA (umbrales que la campaña puede ajustar sin tocar código)
-- =============================================================================
CREATE TABLE campana.parametros (
    clave        text PRIMARY KEY,
    valor        text NOT NULL,
    descripcion  text NOT NULL
);

-- =============================================================================
-- 14. DATOS INICIALES DE CATÁLOGOS
-- =============================================================================

INSERT INTO territorio.tipos_territorio (codigo, nombre, nivel) VALUES
    ('DEPARTAMENTO',   'Departamento',   1),
    ('MUNICIPIO',      'Municipio',      2),
    ('COMUNA',         'Comuna',         3),
    ('CORREGIMIENTO',  'Corregimiento',  3),
    ('BARRIO',         'Barrio',         4),
    ('VEREDA',         'Vereda',         4),
    ('CENTRO_POBLADO', 'Centro poblado', 4);

INSERT INTO territorio.fuentes_geograficas (nombre, entidad, version) VALUES
    ('MGN 2025',                  'DANE',                  '2025'),
    ('Nivel de referencia de veredas', 'DANE',             '2015'),
    ('Divipole territoriales 2023', 'Registraduría',       '2023'),
    ('Cartografía POT Florencia', 'Alcaldía de Florencia', NULL),
    ('Registro de la campaña',    'Campaña',               NULL);

INSERT INTO electoral.tipos_jornada (codigo, nombre) VALUES
    ('TERRITORIAL', 'Elecciones territoriales'),
    ('NACIONAL',    'Elecciones nacionales'),
    ('CONSULTA',    'Consulta partidista o interpartidista');

INSERT INTO electoral.corporaciones (codigo, nombre) VALUES
    ('GOBERNACION', 'Gobernación'),
    ('ASAMBLEA',    'Asamblea departamental'),
    ('ALCALDIA',    'Alcaldía'),
    ('CONCEJO',     'Concejo municipal'),
    ('JAL',         'Junta Administradora Local');

INSERT INTO personas.tipos_documento (codigo, nombre) VALUES
    ('CC', 'Cédula de ciudadanía');

INSERT INTO acceso.roles (codigo, nombre, descripcion) VALUES
    ('SUPERADMIN',   'Superadministrador',   'Equipo técnico'),
    ('CANDIDATO',    'Candidato',            'Lectura de todo el departamento'),
    ('GERENTE',      'Gerente de campaña',   'Gestión general, metas y exportes'),
    ('COORDINADOR',  'Coordinador municipal','Gestión de su territorio'),
    ('LIDER',        'Líder',                'Ve solo su red de referidos'),
    ('DIGITADOR',    'Digitador',            'Solo registra personas'),
    ('TESTIGO',      'Testigo electoral',    'Solo módulo día D');

INSERT INTO acceso.permisos (codigo, descripcion) VALUES
    ('SIMPATIZANTE_CREAR',     'Registrar simpatizantes'),
    ('SIMPATIZANTE_VER',       'Ver simpatizantes'),
    ('SIMPATIZANTE_EDITAR',    'Editar simpatizantes'),
    ('DOCUMENTO_VER',          'Ver número de documento descifrado'),
    ('MIEMBRO_GESTIONAR',      'Gestionar estructura de campaña'),
    ('META_GESTIONAR',         'Definir metas'),
    ('MAPA_VER',               'Ver mapas'),
    ('REPORTE_VER',            'Ver tableros y reportes'),
    ('EXPORTAR',               'Exportar datos'),
    ('ALERTA_GESTIONAR',       'Resolver alertas de calidad'),
    ('EVENTO_GESTIONAR',       'Crear y gestionar eventos'),
    ('COMUNICACION_ENVIAR',    'Programar envíos masivos'),
    ('SOLICITUD_TITULAR',      'Tramitar solicitudes de titulares'),
    ('E14_CARGAR',             'Cargar formularios E-14'),
    ('USUARIO_GESTIONAR',      'Crear usuarios y asignar roles');

INSERT INTO acceso.rol_permisos (rol_codigo, permiso_codigo)
SELECT 'SUPERADMIN', codigo FROM acceso.permisos;

INSERT INTO acceso.rol_permisos (rol_codigo, permiso_codigo) VALUES
    ('CANDIDATO',   'SIMPATIZANTE_VER'), ('CANDIDATO', 'MAPA_VER'), ('CANDIDATO', 'REPORTE_VER'),
    ('GERENTE',     'SIMPATIZANTE_VER'), ('GERENTE', 'SIMPATIZANTE_EDITAR'), ('GERENTE', 'MIEMBRO_GESTIONAR'),
    ('GERENTE',     'META_GESTIONAR'),   ('GERENTE', 'MAPA_VER'), ('GERENTE', 'REPORTE_VER'),
    ('GERENTE',     'EXPORTAR'),         ('GERENTE', 'ALERTA_GESTIONAR'), ('GERENTE', 'EVENTO_GESTIONAR'),
    ('GERENTE',     'COMUNICACION_ENVIAR'), ('GERENTE', 'SOLICITUD_TITULAR'),
    ('COORDINADOR', 'SIMPATIZANTE_CREAR'), ('COORDINADOR', 'SIMPATIZANTE_VER'),
    ('COORDINADOR', 'SIMPATIZANTE_EDITAR'), ('COORDINADOR', 'MIEMBRO_GESTIONAR'),
    ('COORDINADOR', 'MAPA_VER'), ('COORDINADOR', 'REPORTE_VER'), ('COORDINADOR', 'EVENTO_GESTIONAR'),
    ('LIDER',       'SIMPATIZANTE_CREAR'), ('LIDER', 'SIMPATIZANTE_VER'), ('LIDER', 'REPORTE_VER'),
    ('DIGITADOR',   'SIMPATIZANTE_CREAR'),
    ('TESTIGO',     'E14_CARGAR');

INSERT INTO campana.cargos (codigo, nombre, nivel) VALUES
    ('GERENTE',     'Gerente de campaña',    1),
    ('COORDINADOR', 'Coordinador municipal', 2),
    ('LIDER',       'Líder',                 3),
    ('SUBLIDER',    'Sublíder',              4);

INSERT INTO campana.canales_registro (codigo, nombre) VALUES
    ('FORMULARIO_WEB', 'Formulario web'),
    ('CHATBOT_WEB',    'Chatbot web'),
    ('TELEGRAM',       'Bot de Telegram'),
    ('DIGITADOR',      'Digitado por la campaña'),
    ('EVENTO',         'Registro en evento');

INSERT INTO campana.estados_simpatizante (codigo, nombre) VALUES
    ('ACTIVO',      'Activo'),
    ('EN_REVISION', 'En revisión'),
    ('RETIRADO',    'Retirado');

INSERT INTO participacion.categorias_necesidad (codigo, nombre) VALUES
    ('VIAS', 'Vías'), ('AGUA', 'Agua y saneamiento'), ('SALUD', 'Salud'),
    ('EDUCACION', 'Educación'), ('EMPLEO', 'Empleo'), ('SEGURIDAD', 'Seguridad'),
    ('VIVIENDA', 'Vivienda'), ('AGRO', 'Agro y desarrollo rural'),
    ('CONECTIVIDAD', 'Conectividad'), ('AMBIENTE', 'Ambiente'), ('OTRA', 'Otra');

INSERT INTO cumplimiento.finalidades (codigo, descripcion) VALUES
    ('ORGANIZACION_CAMPANA', 'Organización y logística de la campaña'),
    ('COMUNICACIONES',       'Envío de información de la campaña'),
    ('EVENTOS',              'Invitación y registro en eventos'),
    ('ANALISIS_TERRITORIAL', 'Análisis agregado de necesidades por territorio');

INSERT INTO cumplimiento.tipos_solicitud (codigo, nombre, plazo_dias_habiles) VALUES
    ('CONSULTA',      'Consulta de datos',        10),
    ('ACTUALIZACION', 'Actualización/rectificación', 15),
    ('SUPRESION',     'Supresión de datos',       15),
    ('REVOCATORIA',   'Revocatoria de autorización', 15);

INSERT INTO calidad.tipos_alerta (codigo, descripcion, severidad) VALUES
    ('DUPLICADO_ENTRE_LIDERES', 'Varios líderes intentaron registrar a la misma persona', 'MEDIA'),
    ('TELEFONO_REPETIDO',       'El mismo teléfono aparece en varias personas',          'MEDIA'),
    ('REGISTRO_MASIVO',         'Muchos registros de un mismo link en poco tiempo',      'ALTA'),
    ('UBICACION_INCONSISTENTE', 'La ubicación no coincide con el territorio declarado',  'BAJA');

INSERT INTO eventos.tipos_evento (codigo, nombre) VALUES
    ('REUNION', 'Reunión'), ('FORO', 'Foro'), ('CARAVANA', 'Caravana'),
    ('VISITA_VEREDAL', 'Visita veredal');

INSERT INTO campana.parametros (clave, valor, descripcion) VALUES
    ('REGISTRO_MASIVO_UMBRAL',  '20', 'Registros de un mismo link que disparan alerta'),
    ('REGISTRO_MASIVO_MINUTOS', '10', 'Ventana de tiempo para contar registros masivos'),
    ('CHATBOT_RETENCION_DIAS',  '90', 'Días que se guardan los mensajes del chatbot'),
    ('CHECKIN_MARGEN_MINUTOS',  '60', 'Minutos antes y después de un evento en que se acepta el check-in QR'),
    ('LIDER_INACTIVO_DIAS',     '7',  'Días sin registros para considerar inactivo a un líder');

INSERT INTO comunicaciones.canales (codigo, nombre) VALUES
    ('SMS', 'SMS'), ('EMAIL', 'Correo electrónico'), ('TELEGRAM', 'Telegram'),
    ('PUSH', 'Notificación de la app');




-- =============================================================================
-- 15. ÁREA DE CARGA (staging)
-- Aquí caen las capas del caqueta.gpkg tal como vienen, antes de pasarlas a las
-- tablas definitivas con 07_carga_territorio.sql.
-- =============================================================================
CREATE SCHEMA IF NOT EXISTS staging;
-- FIN DEL SCRIPT
