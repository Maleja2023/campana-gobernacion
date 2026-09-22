-- =============================================================================
--  00_instalacion_completa.sql
--  TODO EN UN SOLO ARCHIVO: esquemas, tablas, funciones, triggers, vistas y
--  seguridad (equivale a ejecutar 01 + 02 + 03 + 04 + 05 en orden).
--
--  Uso en pgAdmin: crear la base vacía "campana_gobernacion", abrir la Query
--  Tool sobre ella, cargar este archivo y ejecutarlo UNA vez.
--  Después: 06_importar_gpkg.bat y 07_carga_territorio.sql.
-- =============================================================================



-- #############################################################################
-- ####  01_esquema.sql
-- #############################################################################

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


-- #############################################################################
-- ####  02_funciones.sql
-- #############################################################################

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


-- #############################################################################
-- ####  03_triggers.sql
-- #############################################################################

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


-- #############################################################################
-- ####  04_vistas.sql
-- #############################################################################

-- =============================================================================
--  04_vistas.sql
--  Vistas para tableros, mapas y reportes. Se calculan al consultarlas, así
--  que nunca se desactualizan ni duplican datos.
--
--  Todas usan security_invoker = true: respetan la seguridad por fila (RLS)
--  del usuario que consulta. Un líder que consulta una vista solo ve su red.
--
--  Excepción: la vista materializada mv_conteo_territorio guarda solo CONTEOS
--  (sin datos personales) para que el mapa cargue rápido.
--  Requiere: 01, 02 y 03
-- =============================================================================


-- =============================================================================
-- 1. TERRITORIO Y MAPA
-- =============================================================================

-- Cada territorio con su municipio, departamento y ruta completa.
CREATE VIEW territorio.v_jerarquia WITH (security_invoker = true) AS
SELECT t.id,
       t.tipo_codigo,
       tt.nivel,
       t.nombre,
       t.codigo_oficial,
       t.padre_id,
       territorio.ancestro(t.id, 'MUNICIPIO')    AS municipio_id,
       territorio.ancestro(t.id, 'DEPARTAMENTO') AS departamento_id,
       territorio.ruta(t.id)                     AS ruta,
       t.geom IS NOT NULL                        AS tiene_poligono,
       t.verificado
  FROM territorio.territorios t
  JOIN territorio.tipos_territorio tt ON tt.codigo = t.tipo_codigo;

-- Conteo de simpatizantes ACTIVOS por territorio, sumando todo lo que está
-- debajo (el total de Florencia incluye sus comunas, barrios y veredas).
-- Se refresca con: SELECT campana.refrescar_conteos();
CREATE MATERIALIZED VIEW campana.mv_conteo_territorio AS
WITH RECURSIVE subida AS (
    SELECT s.persona_id, t.id AS territorio_id, t.padre_id
      FROM campana.simpatizantes s
      JOIN territorio.territorios t ON t.id = s.territorio_residencia_id
     WHERE s.estado_codigo = 'ACTIVO'
    UNION ALL
    SELECT su.persona_id, p.id, p.padre_id
      FROM subida su JOIN territorio.territorios p ON p.id = su.padre_id
)
SELECT t.id AS territorio_id,
       count(su.persona_id)::integer AS simpatizantes
  FROM territorio.territorios t
  LEFT JOIN subida su ON su.territorio_id = t.id
 GROUP BY t.id
WITH DATA;

CREATE UNIQUE INDEX uq_mv_conteo_territorio ON campana.mv_conteo_territorio(territorio_id);

-- Capa lista para el mapa coroplético con drill-down:
--   nivel departamento: WHERE padre_id IS NULL
--   clic en Florencia:  WHERE padre_id = <id de Florencia>
CREATE VIEW territorio.v_mapa WITH (security_invoker = true) AS
SELECT t.id,
       t.tipo_codigo,
       t.nombre,
       t.padre_id,
       coalesce(c.simpatizantes, 0) AS simpatizantes,
       (SELECT count(*) FROM territorio.territorios h WHERE h.padre_id = t.id) AS subdivisiones,
       t.geom
  FROM territorio.territorios t
  LEFT JOIN campana.mv_conteo_territorio c ON c.territorio_id = t.id;

-- Veredas y barrios sin ningún simpatizante (zonas por trabajar).
CREATE VIEW territorio.v_zonas_sin_cobertura WITH (security_invoker = true) AS
SELECT t.id, t.tipo_codigo, t.nombre,
       m.nombre AS municipio,
       t.geom
  FROM territorio.territorios t
  JOIN territorio.territorios m ON m.id = territorio.ancestro(t.id, 'MUNICIPIO')
  LEFT JOIN campana.mv_conteo_territorio c ON c.territorio_id = t.id
 WHERE t.tipo_codigo IN ('BARRIO','VEREDA','CENTRO_POBLADO')
   AND coalesce(c.simpatizantes, 0) = 0;


-- =============================================================================
-- 2. SIMPATIZANTES Y RED
-- =============================================================================

CREATE VIEW campana.v_simpatizantes WITH (security_invoker = true) AS
SELECT s.persona_id,
       p.nombres,
       p.apellidos,
       s.territorio_residencia_id,
       res.nombre                  AS territorio_residencia,
       mun.id                      AS municipio_id,
       mun.nombre                  AS municipio,
       l.miembro_id                AS referido_por_miembro_id,
       pl.nombres || ' ' || pl.apellidos AS referido_por,
       s.canal_codigo,
       s.estado_codigo,
       s.capturado_en
  FROM campana.simpatizantes s
  JOIN personas.personas p          ON p.id = s.persona_id
  JOIN territorio.territorios res   ON res.id = s.territorio_residencia_id
  JOIN campana.links_referido l     ON l.id = s.link_referido_id
  JOIN campana.miembros m           ON m.id = l.miembro_id
  JOIN personas.personas pl         ON pl.id = m.persona_id
  LEFT JOIN territorio.territorios mun
         ON mun.id = territorio.ancestro(s.territorio_residencia_id, 'MUNICIPIO');

-- Árbol completo de la estructura de campaña.
CREATE VIEW campana.v_red_miembros WITH (security_invoker = true) AS
WITH RECURSIVE arbol AS (
    SELECT m.id, m.superior_id, m.cargo_codigo, m.persona_id, m.activo,
           1 AS profundidad,
           ARRAY[m.id] AS camino
      FROM campana.miembros m
     WHERE m.superior_id IS NULL
    UNION ALL
    SELECT h.id, h.superior_id, h.cargo_codigo, h.persona_id, h.activo,
           a.profundidad + 1,
           a.camino || h.id
      FROM campana.miembros h JOIN arbol a ON h.superior_id = a.id
)
SELECT a.id AS miembro_id,
       a.superior_id,
       a.cargo_codigo,
       p.nombres || ' ' || p.apellidos AS nombre,
       a.activo,
       a.profundidad,
       a.camino
  FROM arbol a
  JOIN personas.personas p ON p.id = a.persona_id;

-- Desempeño de cada miembro: registros directos, calidad y actividad.
CREATE VIEW campana.v_ranking_miembros WITH (security_invoker = true) AS
SELECT m.id AS miembro_id,
       p.nombres || ' ' || p.apellidos AS nombre,
       m.cargo_codigo,
       count(s.persona_id) FILTER (WHERE s.estado_codigo = 'ACTIVO')                 AS activos,
       count(s.persona_id) FILTER (WHERE s.capturado_en > now() - interval '7 days') AS ultimos_7_dias,
       max(s.capturado_en)                                                            AS ultimo_registro,
       (SELECT count(*) FROM calidad.intentos_duplicado i
          JOIN campana.links_referido li ON li.id = i.link_referido_id
         WHERE li.miembro_id = m.id)                                                  AS intentos_duplicado
  FROM campana.miembros m
  JOIN personas.personas p ON p.id = m.persona_id
  LEFT JOIN campana.links_referido l ON l.miembro_id = m.id
  LEFT JOIN campana.simpatizantes s  ON s.link_referido_id = l.id
 WHERE m.activo
 GROUP BY m.id, p.nombres, p.apellidos, m.cargo_codigo;

-- Líderes sin registros en los últimos N días (parámetro LIDER_INACTIVO_DIAS).
CREATE VIEW campana.v_lideres_inactivos WITH (security_invoker = true) AS
SELECT r.*
  FROM campana.v_ranking_miembros r
 WHERE r.cargo_codigo IN ('LIDER','SUBLIDER')
   AND (r.ultimo_registro IS NULL
        OR r.ultimo_registro < now() - make_interval(days => campana.parametro_int('LIDER_INACTIVO_DIAS')));

-- Crecimiento diario por municipio (para la gráfica de avance).
CREATE VIEW campana.v_registros_diarios WITH (security_invoker = true) AS
SELECT s.capturado_en::date AS fecha,
       territorio.ancestro(s.territorio_residencia_id, 'MUNICIPIO') AS municipio_id,
       s.canal_codigo,
       count(*) AS registros
  FROM campana.simpatizantes s
 GROUP BY 1, 2, 3;

CREATE VIEW campana.v_avance_metas_miembro WITH (security_invoker = true) AS
SELECT mm.miembro_id,
       mm.cantidad AS meta,
       mm.fecha_inicio,
       mm.fecha_limite,
       count(s.persona_id) AS registrados,
       round(100.0 * count(s.persona_id) / mm.cantidad, 1) AS porcentaje
  FROM campana.metas_miembro mm
  JOIN campana.links_referido l ON l.miembro_id = mm.miembro_id
  LEFT JOIN campana.simpatizantes s
         ON s.link_referido_id = l.id
        AND s.estado_codigo = 'ACTIVO'
        AND s.capturado_en::date BETWEEN mm.fecha_inicio AND mm.fecha_limite
 GROUP BY mm.id, mm.miembro_id, mm.cantidad, mm.fecha_inicio, mm.fecha_limite;

CREATE VIEW campana.v_avance_metas_territorio WITH (security_invoker = true) AS
SELECT mt.territorio_id,
       t.nombre AS territorio,
       mt.cantidad AS meta,
       mt.fecha_limite,
       coalesce(c.simpatizantes, 0) AS registrados,
       round(100.0 * coalesce(c.simpatizantes, 0) / mt.cantidad, 1) AS porcentaje
  FROM campana.metas_territorio mt
  JOIN territorio.territorios t ON t.id = mt.territorio_id
  LEFT JOIN campana.mv_conteo_territorio c ON c.territorio_id = mt.territorio_id;

-- Indicadores del tablero principal.
CREATE VIEW campana.v_tablero WITH (security_invoker = true) AS
SELECT
    (SELECT count(*) FROM campana.simpatizantes WHERE estado_codigo = 'ACTIVO')              AS simpatizantes_activos,
    (SELECT count(*) FROM campana.simpatizantes WHERE capturado_en::date = current_date)     AS registros_hoy,
    (SELECT count(*) FROM campana.simpatizantes WHERE capturado_en > now() - interval '7 days') AS registros_semana,
    (SELECT count(*) FROM campana.miembros WHERE activo)                                     AS miembros_activos,
    (SELECT count(*) FROM calidad.alertas WHERE estado IN ('ABIERTA','EN_REVISION'))         AS alertas_abiertas,
    (SELECT count(*) FROM participacion.necesidades)                                         AS necesidades_reportadas;


-- =============================================================================
-- 3. ELECTORAL
-- =============================================================================

-- Brecha electoral: simpatizantes frente al potencial de cada puesto.
CREATE VIEW electoral.v_brecha_puestos WITH (security_invoker = true) AS
SELECT pv.id AS puesto_id,
       pv.nombre AS puesto,
       territorio.ancestro(pv.territorio_id, 'MUNICIPIO') AS municipio_id,
       pj.jornada_id,
       pj.potencial_electoral,
       count(sp.persona_id) AS simpatizantes,
       CASE WHEN pj.potencial_electoral > 0
            THEN round(100.0 * count(sp.persona_id) / pj.potencial_electoral, 2) END AS cobertura_pct,
       pv.geom
  FROM electoral.puestos_votacion pv
  JOIN electoral.puestos_jornada pj ON pj.puesto_id = pv.id
  LEFT JOIN campana.simpatizante_puesto sp
         ON sp.puesto_id = pj.puesto_id AND sp.jornada_id = pj.jornada_id
 GROUP BY pv.id, pv.nombre, pv.territorio_id, pj.jornada_id, pj.potencial_electoral, pv.geom;

-- De dónde vienen los votantes de cada puesto (qué barrios/veredas).
CREATE VIEW electoral.v_origen_votantes_puesto WITH (security_invoker = true) AS
SELECT sp.jornada_id,
       sp.puesto_id,
       s.territorio_residencia_id,
       count(*) AS simpatizantes
  FROM campana.simpatizante_puesto sp
  JOIN campana.simpatizantes s ON s.persona_id = sp.persona_id AND s.estado_codigo = 'ACTIVO'
 GROUP BY sp.jornada_id, sp.puesto_id, s.territorio_residencia_id;

-- Cobertura de testigos por puesto.
CREATE VIEW electoral.v_cobertura_testigos WITH (security_invoker = true) AS
SELECT m.jornada_id,
       m.puesto_id,
       pv.nombre AS puesto,
       count(DISTINCT m.id)                                         AS mesas,
       count(DISTINCT t.mesa_id)                                    AS mesas_con_testigo,
       count(DISTINCT m.id) - count(DISTINCT t.mesa_id)             AS mesas_sin_testigo
  FROM electoral.mesas m
  JOIN electoral.puestos_votacion pv ON pv.id = m.puesto_id
  LEFT JOIN electoral.testigos t ON t.mesa_id = m.id AND t.estado <> 'AUSENTE'
 GROUP BY m.jornada_id, m.puesto_id, pv.nombre;

-- Conteo rápido con los E-14 validados.
CREATE VIEW electoral.v_conteo_rapido WITH (security_invoker = true) AS
SELECT ov.jornada_id,
       ov.corporacion_codigo,
       ov.nombre AS opcion,
       ov.es_candidato_propio,
       sum(r.votos) AS votos,
       count(DISTINCT f.mesa_id) AS mesas_reportadas
  FROM electoral.resultados_e14 r
  JOIN electoral.formularios_e14 f ON f.id = r.formulario_id AND f.estado_revision = 'VALIDADO'
  JOIN electoral.opciones_voto ov  ON ov.id = r.opcion_voto_id
 GROUP BY ov.jornada_id, ov.corporacion_codigo, ov.nombre, ov.es_candidato_propio;


-- =============================================================================
-- 4. PARTICIPACIÓN
-- =============================================================================

-- Necesidades por municipio y categoría (usa la categoría humana o, si no hay,
-- la sugerencia de IA con mayor confianza).
CREATE VIEW participacion.v_necesidades_municipio WITH (security_invoker = true) AS
WITH categorizada AS (
    SELECT n.id, n.territorio_id,
           coalesce(n.categoria_codigo,
                    (SELECT c.categoria_codigo FROM participacion.clasificaciones_ia c
                      WHERE c.necesidad_id = n.id ORDER BY c.confianza DESC LIMIT 1),
                    'OTRA') AS categoria_codigo
      FROM participacion.necesidades n
)
SELECT territorio.ancestro(c.territorio_id, 'MUNICIPIO') AS municipio_id,
       c.categoria_codigo,
       count(*) AS cantidad
  FROM categorizada c
 GROUP BY 1, 2;

-- Categorías con necesidades reportadas pero sin ninguna propuesta publicada.
CREATE VIEW participacion.v_necesidades_sin_propuesta WITH (security_invoker = true) AS
SELECT cn.codigo, cn.nombre, sum(nm.cantidad) AS necesidades
  FROM participacion.v_necesidades_municipio nm
  JOIN participacion.categorias_necesidad cn ON cn.codigo = nm.categoria_codigo
 WHERE NOT EXISTS (
        SELECT 1 FROM participacion.propuesta_categorias pc
          JOIN participacion.propuestas p ON p.id = pc.propuesta_id AND p.publicada
         WHERE pc.categoria_codigo = cn.codigo)
 GROUP BY cn.codigo, cn.nombre;


-- =============================================================================
-- 5. EVENTOS Y COMUNICACIONES
-- =============================================================================

CREATE VIEW eventos.v_resumen_eventos WITH (security_invoker = true) AS
SELECT e.id, e.nombre, e.tipo_codigo, e.inicia_en,
       t.nombre AS territorio,
       count(a.persona_id) AS asistentes,
       count(s.persona_id) AS asistentes_simpatizantes,
       count(s.persona_id) FILTER (WHERE s.canal_codigo = 'EVENTO'
                                     AND s.capturado_en BETWEEN e.inicia_en AND e.termina_en) AS registrados_en_evento
  FROM eventos.eventos e
  JOIN territorio.territorios t ON t.id = e.territorio_id
  LEFT JOIN eventos.asistencias a  ON a.evento_id = e.id
  LEFT JOIN campana.simpatizantes s ON s.persona_id = a.persona_id
 GROUP BY e.id, e.nombre, e.tipo_codigo, e.inicia_en, t.nombre;

-- Personas a las que se les puede escribir por cada canal.
CREATE VIEW comunicaciones.v_contactables WITH (security_invoker = true) AS
SELECT DISTINCT a.persona_id, c.codigo AS canal_codigo
  FROM cumplimiento.autorizaciones a
  JOIN cumplimiento.autorizacion_finalidades af
    ON af.autorizacion_id = a.id AND af.finalidad_codigo = 'COMUNICACIONES'
 CROSS JOIN comunicaciones.canales c
 WHERE a.revocada_en IS NULL
   AND NOT EXISTS (SELECT 1 FROM comunicaciones.bajas b
                    WHERE b.persona_id = a.persona_id AND b.canal_codigo = c.codigo);

CREATE VIEW comunicaciones.v_resumen_envios WITH (security_invoker = true) AS
SELECT e.id, pl.nombre AS plantilla, pl.canal_codigo, e.programado_para, e.estado,
       count(d.persona_id)                                              AS destinatarios,
       count(d.persona_id) FILTER (WHERE d.estado = 'ENVIADO')          AS enviados,
       count(d.persona_id) FILTER (WHERE d.estado = 'FALLIDO')          AS fallidos,
       count(d.persona_id) FILTER (WHERE d.estado = 'OMITIDO_SIN_AUTORIZACION') AS omitidos
  FROM comunicaciones.envios e
  JOIN comunicaciones.plantillas pl ON pl.id = e.plantilla_id
  LEFT JOIN comunicaciones.envio_destinatarios d ON d.envio_id = e.id
 GROUP BY e.id, pl.nombre, pl.canal_codigo, e.programado_para, e.estado;


-- =============================================================================
-- 6. CUMPLIMIENTO Y CALIDAD
-- =============================================================================

-- Solicitudes de titulares con fecha límite en días hábiles (con festivos).
CREATE VIEW cumplimiento.v_solicitudes_plazos WITH (security_invoker = true) AS
SELECT s.id,
       s.radicado,
       s.tipo_codigo,
       s.estado,
       s.recibida_en,
       cumplimiento.sumar_dias_habiles(s.recibida_en::date, t.plazo_dias_habiles) AS fecha_limite,
       CASE
           WHEN s.estado IN ('RESPONDIDA','RECHAZADA') THEN 'CERRADA'
           WHEN current_date > cumplimiento.sumar_dias_habiles(s.recibida_en::date, t.plazo_dias_habiles) THEN 'VENCIDA'
           WHEN current_date > cumplimiento.sumar_dias_habiles(s.recibida_en::date, t.plazo_dias_habiles - 3) THEN 'POR_VENCER'
           ELSE 'EN_PLAZO'
       END AS semaforo
  FROM cumplimiento.solicitudes_titular s
  JOIN cumplimiento.tipos_solicitud t ON t.codigo = s.tipo_codigo;

-- Control: simpatizantes activos sin autorización vigente (debería estar vacía).
CREATE VIEW cumplimiento.v_control_autorizaciones WITH (security_invoker = true) AS
SELECT s.persona_id, s.estado_codigo, s.capturado_en
  FROM campana.simpatizantes s
 WHERE s.estado_codigo = 'ACTIVO'
   AND NOT EXISTS (
        SELECT 1 FROM cumplimiento.autorizaciones a
          JOIN cumplimiento.autorizacion_finalidades af ON af.autorizacion_id = a.id
         WHERE a.persona_id = s.persona_id AND a.revocada_en IS NULL
           AND af.finalidad_codigo = 'ORGANIZACION_CAMPANA');

CREATE VIEW calidad.v_alertas_abiertas WITH (security_invoker = true) AS
SELECT a.id, a.tipo_codigo, ta.severidad, a.estado, a.detectada_en, a.observacion,
       (SELECT count(*) FROM calidad.alerta_personas ap WHERE ap.alerta_id = a.id) AS personas,
       (SELECT count(*) FROM calidad.alerta_miembros am WHERE am.alerta_id = a.id) AS miembros
  FROM calidad.alertas a
  JOIN calidad.tipos_alerta ta ON ta.codigo = a.tipo_codigo
 WHERE a.estado IN ('ABIERTA','EN_REVISION');


-- =============================================================================
-- 7. ACCESO Y AUDITORÍA
-- =============================================================================

CREATE VIEW acceso.v_permisos_usuarios WITH (security_invoker = true) AS
SELECT u.id AS usuario_id, u.login, ur.rol_codigo, rp.permiso_codigo
  FROM acceso.usuarios u
  JOIN acceso.usuario_roles ur ON ur.usuario_id = u.id
  JOIN acceso.rol_permisos rp ON rp.rol_codigo = ur.rol_codigo
 WHERE u.activo;

CREATE VIEW auditoria.v_actividad_usuarios WITH (security_invoker = true) AS
SELECT e.usuario_id, u.login, e.accion,
       e.ocurrido_en::date AS fecha,
       count(*) AS eventos
  FROM auditoria.eventos e
  LEFT JOIN acceso.usuarios u ON u.id = e.usuario_id
 GROUP BY e.usuario_id, u.login, e.accion, e.ocurrido_en::date;


-- #############################################################################
-- ####  05_seguridad.sql
-- #############################################################################

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
