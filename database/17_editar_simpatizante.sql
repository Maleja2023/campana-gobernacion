-- =============================================================================
--  17_editar_simpatizante.sql
--  Agrega la edición de datos de un simpatizante ya registrado (nombres,
--  apellidos, teléfono y territorio de residencia). El retiro ya existía
--  (campana.retirar_simpatizante, en 02_funciones.sql). El documento de
--  identidad no es editable aquí: cambiarlo cambiaría de persona.
--
--  Requiere: 01 a 05 (y de 07 en adelante, si se cargó territorio real).
--  Se puede ejecutar más de una vez.
--
--  No es SECURITY DEFINER, a propósito: debe quedar sujeta a las mismas
--  políticas de RLS que ya protegen personas.personas y campana.simpatizantes
--  (alcance territorial y de red), igual que campana.retirar_simpatizante. Si
--  la persona no es un simpatizante visible para el usuario de la sesión, los
--  UPDATE no afectan ninguna fila; es la API la que decide, comprobando antes
--  (repositorio: `visible()`), si eso corresponde a un 404.
--
--  OJO con territorio_residencia_id: p_simpatizantes_por_territorio y
--  p_simpatizantes_por_red (05_seguridad.sql) no declaran WITH CHECK propio,
--  así que Postgres reutiliza el USING como WITH CHECK, y al ser políticas
--  permisivas se combinan con OR. Como este UPDATE no toca link_referido_id,
--  un usuario que solo tiene alcance por RED seguiría satisfaciendo
--  p_simpatizantes_por_red sin importar a qué territorio reasigne a la
--  persona. Por eso el nuevo territorio se valida aquí explícitamente contra
--  acceso.territorios_visibles() antes de aplicar el cambio.
--
--  OJO con personas.telefonos: a diferencia de p_telefonos_lectura/edicion/
--  borrado, la política p_telefonos_insercion original (05_seguridad.sql)
--  solo exigía "hay una sesión", sin comprobar que persona_id fuera visible
--  — un descuido preexistente que campana.registrar_simpatizante nunca
--  ejercitó por ser SECURITY DEFINER. Como editar_simpatizante SÍ depende de
--  RLS, esa política se corrige aquí para que quede igual de estricta que
--  sus hermanas (mismo patrón: EXISTS sobre personas.personas).
-- =============================================================================

BEGIN;

DROP POLICY IF EXISTS p_telefonos_insercion ON personas.telefonos;
CREATE POLICY p_telefonos_insercion ON personas.telefonos FOR INSERT
    WITH CHECK (EXISTS (SELECT 1 FROM personas.personas p WHERE p.id = telefonos.persona_id));

CREATE OR REPLACE FUNCTION campana.editar_simpatizante(
    p_persona_id        uuid,
    p_nombres           text,
    p_apellidos         text,
    p_territorio_id     integer DEFAULT NULL,
    p_telefono_hash     bytea   DEFAULT NULL,
    p_telefono_cifrado  bytea   DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    UPDATE personas.personas
       SET nombres = p_nombres, apellidos = p_apellidos
     WHERE id = p_persona_id;

    IF p_territorio_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM acceso.territorios_visibles() WHERE territorio_id = p_territorio_id) THEN
            RAISE EXCEPTION 'El territorio % está fuera de su alcance', p_territorio_id;
        END IF;
        UPDATE campana.simpatizantes
           SET territorio_residencia_id = p_territorio_id
         WHERE persona_id = p_persona_id;
    END IF;

    IF p_telefono_hash IS NOT NULL THEN
        -- Degrada el principal actual (si es un número distinto) ANTES de
        -- insertar/promover el nuevo: así nunca hay dos filas es_principal a
        -- la vez (violaría uq_telefono_principal) y el teléfono que el
        -- usuario acaba de indicar queda como el principal.
        UPDATE personas.telefonos
           SET es_principal = false
         WHERE persona_id = p_persona_id AND es_principal AND telefono_hash <> p_telefono_hash;

        INSERT INTO personas.telefonos (persona_id, telefono_hash, telefono_cifrado, es_principal)
        VALUES (p_persona_id, p_telefono_hash, p_telefono_cifrado, true)
        ON CONFLICT (persona_id, telefono_hash) DO UPDATE
            SET telefono_cifrado = EXCLUDED.telefono_cifrado, es_principal = true;
    END IF;
END $$;

-- Higiene de mínimo privilegio: por defecto Postgres da EXECUTE a PUBLIC en
-- toda función nueva. campana.retirar_simpatizante (02_funciones.sql) quedó
-- sin este tratamiento por descuido; se corrige aquí de paso para las dos.
REVOKE EXECUTE ON FUNCTION
      campana.editar_simpatizante(uuid, text, text, integer, bytea, bytea),
      campana.retirar_simpatizante(uuid)
   FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
      campana.editar_simpatizante(uuid, text, text, integer, bytea, bytea),
      campana.retirar_simpatizante(uuid)
   TO rol_app;

COMMIT;
