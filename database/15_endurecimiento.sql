-- =============================================================================
--  15_endurecimiento.sql
--  Endurecimiento de seguridad a nivel de base de datos.
--  Requiere: 01 a 05 y 10 a 14. Se puede ejecutar más de una vez.
-- =============================================================================

-- 1. Límites para el rol de la aplicación: una consulta pesada o una
--    transacción olvidada no puede tumbar la base (defensa contra DoS).
--    Los parámetros de un rol NO se heredan, así que se aplican a cada
--    usuario que pertenece a rol_app (por ejemplo api_campana). Si más
--    adelante se crea otro usuario para la API, vuelva a ejecutar este bloque.
DO $$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT m.rolname
          FROM pg_auth_members am
          JOIN pg_roles g ON g.oid = am.roleid AND g.rolname = 'rol_app'
          JOIN pg_roles m ON m.oid = am.member
    LOOP
        EXECUTE format('ALTER ROLE %I SET statement_timeout = %L', r.rolname, '15s');
        EXECUTE format('ALTER ROLE %I SET idle_in_transaction_session_timeout = %L', r.rolname, '30s');
        EXECUTE format('ALTER ROLE %I SET lock_timeout = %L', r.rolname, '5s');
        EXECUTE format('ALTER ROLE %I CONNECTION LIMIT 30', r.rolname);
        RAISE NOTICE 'Límites aplicados a %', r.rolname;
    END LOOP;
END $$;

-- 2. Nadie distinto del dueño puede crear objetos en el esquema public
--    (evita que un atacante con acceso de la app plante funciones trampa).
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- 3. Bloqueo de cuenta por intentos fallidos (además del límite por IP de la
--    API). Cuenta los LOGIN_FALLIDO recientes de un usuario desde la auditoría.
CREATE OR REPLACE FUNCTION acceso.intentos_fallidos_recientes(p_usuario_id uuid, p_minutos integer)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
    SELECT count(*)::integer
      FROM auditoria.eventos e
     WHERE e.usuario_id = p_usuario_id
       AND e.accion = 'LOGIN_FALLIDO'
       AND e.ocurrido_en > now() - make_interval(mins => p_minutos)
       -- solo cuentan los fallos posteriores al último ingreso exitoso
       AND e.ocurrido_en > coalesce((SELECT max(x.ocurrido_en) FROM auditoria.eventos x
                                      WHERE x.usuario_id = p_usuario_id AND x.accion = 'LOGIN'),
                                    '-infinity'::timestamptz);
$$;

REVOKE EXECUTE ON FUNCTION acceso.intentos_fallidos_recientes(uuid, integer) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION acceso.intentos_fallidos_recientes(uuid, integer) TO rol_app;

CREATE INDEX IF NOT EXISTS ix_auditoria_login
    ON auditoria.eventos (usuario_id, ocurrido_en) WHERE accion IN ('LOGIN','LOGIN_FALLIDO');

INSERT INTO campana.parametros (clave, valor, descripcion) VALUES
    ('BLOQUEO_INTENTOS', '5',  'Intentos fallidos seguidos que bloquean temporalmente una cuenta'),
    ('BLOQUEO_MINUTOS',  '15', 'Minutos que dura el bloqueo temporal de una cuenta')
ON CONFLICT (clave) DO NOTHING;

GRANT SELECT ON campana.parametros TO rol_app;
