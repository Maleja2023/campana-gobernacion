-- =============================================================================
--  12_administracion_usuarios.sql
--  Soporte para el módulo de administración de usuarios de la API.
--  Requiere: 01 a 05, 10 y 11. Se puede ejecutar más de una vez.
-- =============================================================================

-- Contraseña temporal: el usuario debe cambiarla en su primer ingreso.
ALTER TABLE acceso.usuarios
    ADD COLUMN IF NOT EXISTS debe_cambiar_clave boolean NOT NULL DEFAULT false;

-- El gerente puede administrar usuarios (antes solo el superadministrador).
INSERT INTO acceso.rol_permisos (rol_codigo, permiso_codigo)
VALUES ('GERENTE', 'USUARIO_GESTIONAR')
ON CONFLICT DO NOTHING;

-- Qué roles puede asignar cada rol. Evita que alguien se dé o dé a otros más
-- poder del que tiene (por ejemplo, un gerente creando superadministradores).
CREATE TABLE IF NOT EXISTS acceso.roles_asignables (
    rol_asignador  text NOT NULL REFERENCES acceso.roles(codigo) ON DELETE CASCADE,
    rol_asignable  text NOT NULL REFERENCES acceso.roles(codigo) ON DELETE CASCADE,
    PRIMARY KEY (rol_asignador, rol_asignable)
);

INSERT INTO acceso.roles_asignables (rol_asignador, rol_asignable)
SELECT 'SUPERADMIN', codigo FROM acceso.roles
ON CONFLICT DO NOTHING;

INSERT INTO acceso.roles_asignables (rol_asignador, rol_asignable) VALUES
    ('GERENTE', 'CANDIDATO'),
    ('GERENTE', 'COORDINADOR'),
    ('GERENTE', 'LIDER'),
    ('GERENTE', 'DIGITADOR'),
    ('GERENTE', 'TESTIGO')
ON CONFLICT DO NOTHING;

GRANT SELECT ON acceso.roles_asignables TO rol_app, rol_reportes;

-- Roles que el usuario actual puede asignar.
CREATE OR REPLACE FUNCTION acceso.roles_que_puedo_asignar()
RETURNS TABLE (rol_codigo text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
    SELECT DISTINCT ra.rol_asignable
      FROM acceso.usuario_roles ur
      JOIN acceso.roles_asignables ra ON ra.rol_asignador = ur.rol_codigo
      JOIN acceso.usuarios u ON u.id = ur.usuario_id AND u.activo
     WHERE ur.usuario_id = acceso.usuario_actual();
$$;

GRANT EXECUTE ON FUNCTION acceso.roles_que_puedo_asignar() TO rol_app;
