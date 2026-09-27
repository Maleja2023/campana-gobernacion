-- =============================================================================
--  18_grants_mantenimiento.sql
--  Higiene de mínimo privilegio para chatbot.purgar_mensajes() (02_funciones.sql):
--  es SECURITY DEFINER pero, a diferencia de campana.refrescar_conteos() (su
--  compañera de mantenimiento, ya tratada en 05_seguridad.sql), quedó sin
--  REVOKE/GRANT explícito y por lo tanto ejecutable por PUBLIC por defecto.
--  El backend empieza a invocarla de forma periódica (módulo mantenimiento/),
--  así que es un buen momento para cerrar esto también.
--
--  Requiere: 01 a 05. Se puede ejecutar más de una vez.
-- =============================================================================

BEGIN;

REVOKE EXECUTE ON FUNCTION chatbot.purgar_mensajes() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION chatbot.purgar_mensajes() TO rol_app;

COMMIT;
