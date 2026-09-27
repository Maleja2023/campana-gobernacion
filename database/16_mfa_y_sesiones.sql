-- =============================================================================
--  16_mfa_y_sesiones.sql
--  Doble factor (TOTP con app de autenticación) y sesiones con cookies seguras
--  (token de acceso corto + token de renovación rotativo).
--  Requiere: 01 a 05 y 10 a 15. Se puede ejecutar más de una vez.
-- =============================================================================

-- 1. Roles que exigen doble factor. Se puede cambiar por rol sin tocar código.
ALTER TABLE acceso.roles ADD COLUMN IF NOT EXISTS requiere_mfa boolean NOT NULL DEFAULT false;
UPDATE acceso.roles SET requiere_mfa = true
 WHERE codigo IN ('SUPERADMIN', 'GERENTE', 'CANDIDATO', 'COORDINADOR');

CREATE OR REPLACE FUNCTION acceso.usuario_requiere_mfa(p_usuario_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
    SELECT EXISTS (
        SELECT 1 FROM acceso.usuario_roles ur
          JOIN acceso.roles r ON r.codigo = ur.rol_codigo
         WHERE ur.usuario_id = p_usuario_id AND r.requiere_mfa);
$$;
REVOKE EXECUTE ON FUNCTION acceso.usuario_requiere_mfa(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION acceso.usuario_requiere_mfa(uuid) TO rol_app;

-- 2. Factor TOTP: se confirma escaneando el QR e ingresando un código; se
--    guarda el último paso usado para impedir reutilizar el mismo código.
ALTER TABLE acceso.factores_mfa
    ADD COLUMN IF NOT EXISTS confirmado_en timestamptz,
    ADD COLUMN IF NOT EXISTS ultimo_paso bigint;

-- 3. Códigos de recuperación (si se pierde el celular). Solo se guarda su
--    hash; cada código sirve una sola vez.
CREATE TABLE IF NOT EXISTS acceso.codigos_recuperacion (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id   uuid NOT NULL REFERENCES acceso.usuarios(id) ON DELETE CASCADE,
    codigo_hash  text NOT NULL,
    creado_en    timestamptz NOT NULL DEFAULT now(),
    usado_en     timestamptz
);
CREATE INDEX IF NOT EXISTS ix_codigos_recuperacion_usuario
    ON acceso.codigos_recuperacion (usuario_id) WHERE usado_en IS NULL;

-- 4. Sesiones: estado del doble factor y token de renovación rotativo.
--    Solo se guarda el hash del token de renovación. Si alguien presenta un
--    token ya rotado (señal de robo), la API cierra la sesión completa.
ALTER TABLE acceso.sesiones
    ADD COLUMN IF NOT EXISTS mfa_verificado boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS renovacion_hash bytea,
    ADD COLUMN IF NOT EXISTS renovacion_anterior_hash bytea,
    ADD COLUMN IF NOT EXISTS renovacion_expira_en timestamptz,
    ADD COLUMN IF NOT EXISTS ultimo_uso_en timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS uq_sesiones_renovacion
    ON acceso.sesiones (renovacion_hash) WHERE renovacion_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_sesiones_renovacion_anterior
    ON acceso.sesiones (renovacion_anterior_hash) WHERE renovacion_anterior_hash IS NOT NULL;

-- 5. Auditoría de eventos de seguridad (acciones nuevas en la bitácora).
ALTER TABLE auditoria.eventos DROP CONSTRAINT IF EXISTS eventos_accion_check;
ALTER TABLE auditoria.eventos ADD CONSTRAINT eventos_accion_check CHECK (accion IN
    ('INSERT','UPDATE','DELETE','CONSULTA','EXPORTACION','LOGIN','LOGIN_FALLIDO',
     'MFA_ACTIVADO','MFA_FALLIDO','MFA_RESTABLECIDO','CODIGO_RECUPERACION_USADO',
     'RENOVACION_REUTILIZADA'));

CREATE OR REPLACE FUNCTION auditoria.registrar_seguridad(p_usuario_id uuid, p_accion text, p_ip inet)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
    INSERT INTO auditoria.eventos (usuario_id, accion, esquema, tabla, registro_id, ip)
    VALUES (p_usuario_id, p_accion, 'acceso', 'usuarios', p_usuario_id::text, p_ip);
$$;
REVOKE EXECUTE ON FUNCTION auditoria.registrar_seguridad(uuid, text, inet) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION auditoria.registrar_seguridad(uuid, text, inet) TO rol_app;

-- Los intentos fallidos de doble factor también cuentan para el bloqueo.
CREATE OR REPLACE FUNCTION acceso.intentos_fallidos_recientes(p_usuario_id uuid, p_minutos integer)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
    SELECT count(*)::integer
      FROM auditoria.eventos e
     WHERE e.usuario_id = p_usuario_id
       AND e.accion IN ('LOGIN_FALLIDO', 'MFA_FALLIDO')
       AND e.ocurrido_en > now() - make_interval(mins => p_minutos)
       AND e.ocurrido_en > coalesce((SELECT max(x.ocurrido_en) FROM auditoria.eventos x
                                      WHERE x.usuario_id = p_usuario_id AND x.accion = 'LOGIN'),
                                    '-infinity'::timestamptz);
$$;

-- 6. Privilegios
GRANT SELECT, INSERT, UPDATE, DELETE ON acceso.codigos_recuperacion TO rol_app;
REVOKE SELECT ON acceso.codigos_recuperacion FROM rol_reportes;
