-- =============================================================================
--  09_consultas_utiles.sql
--  Consultas de referencia que usará la API y para reportes manuales.
--  No crea nada: se ejecutan una a una (selecciónala y F5 en pgAdmin).
--
--  Para probar con los permisos de un usuario de la app, antes de la consulta:
--    BEGIN;
--    SET LOCAL ROLE rol_app;
--    SET LOCAL app.usuario_id = '<uuid del usuario>';
--    ... consulta ...
--    COMMIT;
-- =============================================================================


-- ---------------------------------------------------------------------------
-- MAPA
-- ---------------------------------------------------------------------------

-- 1. GeoJSON de los municipios con su total de simpatizantes (capa inicial del mapa)
SELECT json_build_object(
         'type', 'FeatureCollection',
         'features', json_agg(json_build_object(
             'type', 'Feature',
             'id', m.id,
             'geometry', ST_AsGeoJSON(ST_SimplifyPreserveTopology(m.geom, 0.001), 6)::json,
             'properties', json_build_object('nombre', m.nombre, 'simpatizantes', m.simpatizantes)
         )))
  FROM territorio.v_mapa m
 WHERE m.tipo_codigo = 'MUNICIPIO';

-- 2. Drill-down: al hacer clic en Florencia, sus comunas, corregimientos y veredas
SELECT m.id, m.tipo_codigo, m.nombre, m.simpatizantes, m.subdivisiones
  FROM territorio.v_mapa m
 WHERE m.padre_id = (SELECT id FROM territorio.territorios WHERE codigo_oficial = '18001')
 ORDER BY m.simpatizantes DESC;

-- 3. Puestos de votación de un municipio con su cobertura (capa de puntos)
SELECT puesto, potencial_electoral, simpatizantes, cobertura_pct,
       ST_X(geom) AS lon, ST_Y(geom) AS lat
  FROM electoral.v_brecha_puestos
 WHERE municipio_id = (SELECT id FROM territorio.territorios WHERE codigo_oficial = '18001')
 ORDER BY simpatizantes DESC;

-- 4. Veredas sin ningún simpatizante en San Vicente del Caguán
SELECT nombre
  FROM territorio.v_zonas_sin_cobertura
 WHERE municipio = 'SAN VICENTE DEL CAGUÁN' AND tipo_codigo = 'VEREDA'
 ORDER BY nombre;


-- ---------------------------------------------------------------------------
-- FORMULARIO DE REGISTRO
-- ---------------------------------------------------------------------------

-- 5. Buscador de barrio/vereda mientras la persona escribe ("porvenir", "la y"...)
SELECT * FROM territorio.buscar('porvenir');
SELECT * FROM territorio.buscar('esmeralda', 'VEREDA');

-- 6. ¿En qué vereda o barrio está este punto GPS?
SELECT id, territorio.ruta(id) FROM (SELECT territorio.ubicar_punto(-75.6062, 1.6144) AS id) x;

-- 7. Puestos de votación más cercanos a un punto
SELECT * FROM electoral.puestos_cercanos(-75.6062, 1.6144,
       (SELECT id FROM electoral.jornadas WHERE nombre = 'Territoriales 2023'), 5);

-- 8. Registrar un simpatizante (así lo llama la API; hash y cifrado los calcula NestJS)
-- SELECT * FROM campana.registrar_simpatizante(
--     'CC', '\x...hash...', '\x...cifrado...', 'Nombres', 'Apellidos',
--     '\x...hash tel...', '\x...cifrado tel...',
--     <territorio_id>, 'CODIGOLINK', 'CHATBOT_WEB', 1::smallint,
--     ARRAY['ORGANIZACION_CAMPANA','COMUNICACIONES'], 'Casilla marcada en chatbot');


-- ---------------------------------------------------------------------------
-- TABLERO Y DESEMPEÑO
-- ---------------------------------------------------------------------------

-- 9. Indicadores principales
SELECT * FROM campana.v_tablero;

-- 10. Simpatizantes por municipio
SELECT m.nombre AS municipio, c.simpatizantes
  FROM territorio.territorios m
  JOIN campana.mv_conteo_territorio c ON c.territorio_id = m.id
 WHERE m.tipo_codigo = 'MUNICIPIO'
 ORDER BY c.simpatizantes DESC;

-- 11. Crecimiento semanal del departamento
SELECT date_trunc('week', fecha)::date AS semana, sum(registros) AS registros
  FROM campana.v_registros_diarios
 GROUP BY 1 ORDER BY 1;

-- 12. Top 10 líderes
SELECT nombre, activos, ultimos_7_dias, intentos_duplicado
  FROM campana.v_ranking_miembros
 WHERE cargo_codigo IN ('LIDER','SUBLIDER')
 ORDER BY activos DESC LIMIT 10;

-- 13. Avance de metas de los líderes (de menor a mayor)
SELECT r.nombre, a.meta, a.registrados, a.porcentaje, a.fecha_limite
  FROM campana.v_avance_metas_miembro a
  JOIN campana.v_ranking_miembros r ON r.miembro_id = a.miembro_id
 ORDER BY a.porcentaje;

-- 14. Líderes inactivos
SELECT nombre, ultimo_registro FROM campana.v_lideres_inactivos ORDER BY ultimo_registro NULLS FIRST;

-- 15. Árbol de la estructura de campaña (indentado)
SELECT repeat('    ', profundidad - 1) || nombre || ' (' || cargo_codigo || ')' AS estructura
  FROM campana.v_red_miembros
 ORDER BY camino;

-- 16. Canal por el que llegan los registros
SELECT canal_codigo, sum(registros) AS registros
  FROM campana.v_registros_diarios GROUP BY 1 ORDER BY 2 DESC;


-- ---------------------------------------------------------------------------
-- ELECTORAL
-- ---------------------------------------------------------------------------

-- 17. De qué barrios/veredas vienen los votantes de cada puesto de Florencia
SELECT pv.nombre AS puesto, t.nombre AS viven_en, o.simpatizantes
  FROM electoral.v_origen_votantes_puesto o
  JOIN electoral.puestos_votacion pv ON pv.id = o.puesto_id
  JOIN territorio.territorios t      ON t.id = o.territorio_residencia_id
 WHERE territorio.ancestro(pv.territorio_id, 'MUNICIPIO')
       = (SELECT id FROM territorio.territorios WHERE codigo_oficial = '18001')
 ORDER BY pv.nombre, o.simpatizantes DESC;

-- 18. Mesas sin testigo (día D)
SELECT puesto, mesas, mesas_sin_testigo
  FROM electoral.v_cobertura_testigos
 WHERE mesas_sin_testigo > 0
 ORDER BY mesas_sin_testigo DESC;

-- 19. Conteo rápido
SELECT opcion, votos, mesas_reportadas
  FROM electoral.v_conteo_rapido
 WHERE corporacion_codigo = 'GOBERNACION'
 ORDER BY votos DESC;


-- ---------------------------------------------------------------------------
-- VOZ DEL TERRITORIO
-- ---------------------------------------------------------------------------

-- 20. Necesidades más reportadas por municipio
SELECT t.nombre AS municipio, c.nombre AS categoria, n.cantidad
  FROM participacion.v_necesidades_municipio n
  JOIN territorio.territorios t ON t.id = n.municipio_id
  JOIN participacion.categorias_necesidad c ON c.codigo = n.categoria_codigo
 ORDER BY t.nombre, n.cantidad DESC;

-- 21. Temas que la gente pide y el programa de gobierno aún no cubre
SELECT * FROM participacion.v_necesidades_sin_propuesta ORDER BY necesidades DESC;


-- ---------------------------------------------------------------------------
-- CALIDAD, CUMPLIMIENTO Y AUDITORÍA
-- ---------------------------------------------------------------------------

-- 22. Alertas abiertas
SELECT tipo_codigo, severidad, detectada_en, personas, miembros, observacion
  FROM calidad.v_alertas_abiertas ORDER BY severidad, detectada_en;

-- 23. Solicitudes de titulares vencidas o por vencer (Ley 1581)
SELECT radicado, tipo_codigo, recibida_en, fecha_limite, semaforo
  FROM cumplimiento.v_solicitudes_plazos
 WHERE semaforo IN ('VENCIDA','POR_VENCER');

-- 24. Control legal: simpatizantes activos sin autorización (debe dar 0 filas)
SELECT count(*) FROM cumplimiento.v_control_autorizaciones;

-- 25. Festivos del próximo año (para verificar los plazos)
SELECT * FROM cumplimiento.festivos(extract(year FROM current_date)::int + 1) ORDER BY fecha;

-- 26. Atender una solicitud de SUPRESIÓN (borra a la persona y cierra la solicitud).
--     CALL no admite subconsultas: se pasa el id de la solicitud directamente.
-- CALL cumplimiento.suprimir_persona('<uuid de la solicitud>', 'Sus datos fueron eliminados');

-- 26b. Quién exportó datos en los últimos 30 días
SELECT u.login, e.motivo, e.formato, e.cantidad_registros, e.exportado_en
  FROM auditoria.exportaciones e JOIN acceso.usuarios u ON u.id = e.usuario_id
 WHERE e.exportado_en > now() - interval '30 days'
 ORDER BY e.exportado_en DESC;

-- 27. Historial de cambios de un registro
SELECT e.ocurrido_en, u.login, e.accion, string_agg(c.campo, ', ') AS campos
  FROM auditoria.eventos e
  LEFT JOIN acceso.usuarios u ON u.id = e.usuario_id
  LEFT JOIN auditoria.evento_campos c ON c.evento_id = e.id
 WHERE e.tabla = 'simpatizantes'
 GROUP BY e.id, e.ocurrido_en, u.login, e.accion
 ORDER BY e.ocurrido_en DESC LIMIT 20;


-- ---------------------------------------------------------------------------
-- MANTENIMIENTO (programar diariamente)
-- ---------------------------------------------------------------------------

-- 28. Refrescar los conteos del mapa (cada 5-15 minutos es suficiente)
SELECT campana.refrescar_conteos();

-- 29. Borrar mensajes viejos del chatbot
SELECT chatbot.purgar_mensajes();
