-- =============================================================================
--  21_retiro_y_puesto_simpatizante.sql
--  Completa la edición y el retiro de simpatizantes:
--    1. El retiro exige un motivo y deja constancia de cuándo se hizo.
--    2. Se puede reactivar a quien fue retirado.
--    3. La edición acepta cambios parciales (solo los campos enviados) y
--       permite cambiar el puesto de votación.
--
--  Requiere: 01 a 05 y 17. Se puede ejecutar más de una vez.
--
--  OJO CON EL ORDEN: esta migración REEMPLAZA las firmas de
--  campana.retirar_simpatizante(uuid) y
--  campana.editar_simpatizante(uuid,text,text,integer,bytea,bytea) por otras
--  con parámetros nuevos, y borra las viejas. Son dos razones distintas:
--    - retirar: si dejara viva la versión de 1 argumento, cualquier código
--      futuro podría retirar sin motivo, que es justo lo que se quiere evitar.
--    - editar: dejar las dos versiones haría AMBIGUA la llamada de 6
--      argumentos (la nueva tiene el séptimo con DEFAULT), y PostgreSQL
--      fallaría con "function is not unique".
--  Como consecuencia, después de aplicar esta migración el archivo
--  17_editar_simpatizante.sql ya NO se puede volver a ejecutar tal cual: su
--  REVOKE/GRANT nombra las firmas viejas. No hace falta volver a ejecutarlo
--  (lo que aporta ya quedó aplicado); si por alguna razón hay que hacerlo,
--  ejecútese 17 ANTES que esta.
--
--  Ninguna de las funciones es SECURITY DEFINER, igual que en 17: deben quedar
--  sujetas a la seguridad por fila del usuario que llama. Si la persona no es
--  un simpatizante visible para él, los UPDATE no afectan ninguna fila y es la
--  API la que decide que eso es un 404 (repositorio: `visible()`).
-- =============================================================================

BEGIN;

-- 1. Motivo y fecha del retiro -------------------------------------------------
-- Es información administrativa de la campaña (por qué se retiró a alguien),
-- no un dato personal del titular: por eso va en la fila y no en la bitácora,
-- que por diseño guarda qué campos cambiaron pero nunca sus valores.
ALTER TABLE campana.simpatizantes
    ADD COLUMN IF NOT EXISTS motivo_retiro text,
    ADD COLUMN IF NOT EXISTS retirado_en   timestamptz;

COMMENT ON COLUMN campana.simpatizantes.motivo_retiro IS
    'Por qué se retiró a la persona. Lo exige campana.retirar_simpatizante.';
COMMENT ON COLUMN campana.simpatizantes.retirado_en IS
    'Cuándo se retiró. Se limpia al reactivar.';

-- 2. Retiro con motivo obligatorio --------------------------------------------
DROP FUNCTION IF EXISTS campana.retirar_simpatizante(uuid);
DROP FUNCTION IF EXISTS campana.retirar_simpatizante(uuid, text);

CREATE FUNCTION campana.retirar_simpatizante(p_persona_id uuid, p_motivo text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_motivo IS NULL OR length(btrim(p_motivo)) < 5 THEN
        RAISE EXCEPTION 'El motivo del retiro es obligatorio (mínimo 5 caracteres)';
    END IF;

    UPDATE campana.simpatizantes
       SET estado_codigo = 'RETIRADO',
           motivo_retiro  = btrim(p_motivo),
           retirado_en    = now()
     WHERE persona_id = p_persona_id;
END $$;

-- 3. Reactivación --------------------------------------------------------------
DROP FUNCTION IF EXISTS campana.reactivar_simpatizante(uuid);

CREATE FUNCTION campana.reactivar_simpatizante(p_persona_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    v_estado text;
BEGIN
    -- La consulta pasa por RLS: si la persona no es visible, v_estado queda
    -- NULL y se responde igual que si no existiera.
    SELECT estado_codigo INTO v_estado
      FROM campana.simpatizantes
     WHERE persona_id = p_persona_id;

    IF v_estado IS NULL THEN
        RETURN;                       -- la API lo traduce a 404
    END IF;
    IF v_estado <> 'RETIRADO' THEN
        RAISE EXCEPTION 'Solo se puede reactivar a quien está retirado';
    END IF;

    UPDATE campana.simpatizantes
       SET estado_codigo = 'ACTIVO',
           motivo_retiro  = NULL,
           retirado_en    = NULL
     WHERE persona_id = p_persona_id;
END $$;

-- 4. Edición parcial, ahora también del puesto de votación ---------------------
DROP FUNCTION IF EXISTS campana.editar_simpatizante(uuid, text, text, integer, bytea, bytea);
DROP FUNCTION IF EXISTS campana.editar_simpatizante(uuid, text, text, integer, bytea, bytea, integer);

CREATE FUNCTION campana.editar_simpatizante(
    p_persona_id        uuid,
    p_nombres           text    DEFAULT NULL,
    p_apellidos         text    DEFAULT NULL,
    p_territorio_id     integer DEFAULT NULL,
    p_telefono_hash     bytea   DEFAULT NULL,
    p_telefono_cifrado  bytea   DEFAULT NULL,
    p_puesto_id         integer DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
    v_jornada smallint;
BEGIN
    -- NULL significa "no cambiar": así el PATCH aplica solo lo que se envió.
    IF p_nombres IS NOT NULL OR p_apellidos IS NOT NULL THEN
        UPDATE personas.personas
           SET nombres   = coalesce(p_nombres, nombres),
               apellidos = coalesce(p_apellidos, apellidos)
         WHERE id = p_persona_id;
    END IF;

    IF p_territorio_id IS NOT NULL THEN
        -- Igual que en 17: las políticas de campana.simpatizantes no declaran
        -- WITH CHECK propio, así que sin esta comprobación un usuario con
        -- alcance solo por RED podría mover a la persona a un territorio que
        -- no ve.
        IF NOT EXISTS (SELECT 1 FROM acceso.territorios_visibles() WHERE territorio_id = p_territorio_id) THEN
            RAISE EXCEPTION 'El territorio % está fuera de su alcance', p_territorio_id;
        END IF;
        UPDATE campana.simpatizantes
           SET territorio_residencia_id = p_territorio_id
         WHERE persona_id = p_persona_id;
    END IF;

    IF p_telefono_hash IS NOT NULL THEN
        -- Degrada el principal actual (si es otro número) ANTES de insertar el
        -- nuevo: nunca puede haber dos principales a la vez.
        UPDATE personas.telefonos
           SET es_principal = false
         WHERE persona_id = p_persona_id AND es_principal AND telefono_hash <> p_telefono_hash;

        INSERT INTO personas.telefonos (persona_id, telefono_hash, telefono_cifrado, es_principal)
        VALUES (p_persona_id, p_telefono_hash, p_telefono_cifrado, true)
        ON CONFLICT (persona_id, telefono_hash) DO UPDATE
            SET telefono_cifrado = EXCLUDED.telefono_cifrado, es_principal = true;
    END IF;

    IF p_puesto_id IS NOT NULL THEN
        SELECT id INTO v_jornada
          FROM electoral.jornadas
         ORDER BY fecha DESC, id DESC
         LIMIT 1;
        IF v_jornada IS NULL THEN
            RAISE EXCEPTION 'No hay ninguna jornada electoral cargada';
        END IF;

        INSERT INTO campana.simpatizante_puesto (persona_id, jornada_id, puesto_id, fuente)
        VALUES (p_persona_id, v_jornada, p_puesto_id, 'VERIFICADO_COORDINADOR')
        ON CONFLICT (persona_id, jornada_id) DO UPDATE
            SET puesto_id = EXCLUDED.puesto_id,
                fuente    = 'VERIFICADO_COORDINADOR';
    END IF;
END $$;

-- 5. Mínimo privilegio ---------------------------------------------------------
REVOKE EXECUTE ON FUNCTION
      campana.editar_simpatizante(uuid, text, text, integer, bytea, bytea, integer),
      campana.retirar_simpatizante(uuid, text),
      campana.reactivar_simpatizante(uuid)
   FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
      campana.editar_simpatizante(uuid, text, text, integer, bytea, bytea, integer),
      campana.retirar_simpatizante(uuid, text),
      campana.reactivar_simpatizante(uuid)
   TO rol_app;

COMMIT;
