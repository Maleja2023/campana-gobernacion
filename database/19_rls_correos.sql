-- =============================================================================
--  19_rls_correos.sql
--  Cierra en personas.correos el mismo hueco que 17_editar_simpatizante.sql
--  cerró en personas.telefonos: la política de INSERT solo exigía "hay una
--  sesión", sin comprobar que la persona fuera visible para ese usuario, a
--  diferencia de sus hermanas de SELECT/UPDATE/DELETE (05_seguridad.sql
--  líneas 161-169), que sí lo exigen.
--
--  Hoy ninguna ruta de la API inserta correos, así que no es explotable: se
--  corrige de forma preventiva para que la primera función que lo haga (y que
--  no sea SECURITY DEFINER) herede el alcance territorial correcto en vez de
--  depender de un chequeo en la capa de aplicación.
--
--  Requiere: 01 a 05. Se puede ejecutar más de una vez.
-- =============================================================================

BEGIN;

DROP POLICY IF EXISTS p_correos_insercion ON personas.correos;
CREATE POLICY p_correos_insercion ON personas.correos FOR INSERT
    WITH CHECK (EXISTS (SELECT 1 FROM personas.personas p WHERE p.id = correos.persona_id));

COMMIT;
