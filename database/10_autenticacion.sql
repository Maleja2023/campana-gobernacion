-- =============================================================================
--  10_autenticacion.sql
--  Soporte en la base para el login de la API.
--  Requiere: 01 a 05. Se ejecuta una vez, también en bases ya instaladas.
-- =============================================================================

-- Registra intentos de inicio de sesión (exitosos y fallidos) en la bitácora.
-- La API no puede escribir directamente en auditoría; lo hace por aquí.
CREATE OR REPLACE FUNCTION auditoria.registrar_acceso(
    p_usuario_id uuid,
    p_exitoso    boolean,
    p_ip         inet
) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
    INSERT INTO auditoria.eventos (usuario_id, accion, esquema, tabla, registro_id, ip)
    VALUES (p_usuario_id,
            CASE WHEN p_exitoso THEN 'LOGIN' ELSE 'LOGIN_FALLIDO' END,
            'acceso', 'usuarios', p_usuario_id::text, p_ip);
$$;

REVOKE EXECUTE ON FUNCTION auditoria.registrar_acceso(uuid, boolean, inet) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION auditoria.registrar_acceso(uuid, boolean, inet) TO rol_app;

-- Búsqueda rápida de sesiones abiertas (se consulta en cada petición).
CREATE INDEX IF NOT EXISTS ix_sesiones_abiertas
    ON acceso.sesiones (id, usuario_id) WHERE cerrada_en IS NULL;
