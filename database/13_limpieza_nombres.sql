-- =============================================================================
--  13_limpieza_nombres.sql
--  Quita caracteres de control invisibles que venían en los datos del DANE
--  (por ejemplo "RÍO BRAVO" traía un carácter U+008D entre la Í y la O, que el
--  mapa mostraba como un cuadro). Se puede ejecutar más de una vez.
-- =============================================================================

UPDATE territorio.territorios
   SET nombre = regexp_replace(nombre, '[\u0000-\u001F\u007F-\u009F]', '', 'g')
 WHERE nombre ~ '[\u0000-\u001F\u007F-\u009F]';

UPDATE electoral.puestos_votacion
   SET nombre = regexp_replace(nombre, '[\u0000-\u001F\u007F-\u009F]', '', 'g')
 WHERE nombre ~ '[\u0000-\u001F\u007F-\u009F]';

UPDATE electoral.puestos_votacion
   SET direccion = regexp_replace(direccion, '[\u0000-\u001F\u007F-\u009F]', '', 'g')
 WHERE direccion ~ '[\u0000-\u001F\u007F-\u009F]';

UPDATE territorio.nombres_alternos
   SET nombre = regexp_replace(nombre, '[\u0000-\u001F\u007F-\u009F]', '', 'g')
 WHERE nombre ~ '[\u0000-\u001F\u007F-\u009F]';
