-- =============================================================================
--  20_seguridad_conteo_territorio.sql
--  Cierra una fuga real: campana.mv_conteo_territorio es una vista MATERIALIZADA
--  (no puede tener seguridad por fila) y estaba otorgada en GRANT SELECT directo
--  a rol_app. Cualquier consulta contra ella, o contra las vistas que hacían
--  LEFT JOIN directo, devolvía los conteos de TODOS los territorios sin filtrar
--  por acceso.territorios_visibles(): una coordinadora de Florencia veía el
--  total de simpatizantes de San Vicente, Cartagena del Chairá, etc.
--
--  Afectaba: territorio.v_mapa (el mapa), territorio.v_zonas_sin_cobertura
--  (aún no consumida por el backend) y campana.v_avance_metas_territorio
--  (avance de metas por territorio en el tablero).
--
--  Corrección: se quita a rol_app el GRANT directo sobre la vista materializada
--  y se crea campana.conteo_territorio_visible(), SECURITY DEFINER con
--  search_path fijo, que solo devuelve los territorios dentro de
--  acceso.territorios_visibles() del usuario actual (misma función que ya usan
--  las políticas de RLS de campana.simpatizantes). Las tres vistas pasan a usar
--  esta función en vez de la vista materializada.
--
--  Como la vista materializada tiene una fila para CADA territorio (incluso con
--  0 simpatizantes, por el LEFT JOIN de su propia definición en 04_vistas.sql),
--  la ausencia de fila en conteo_territorio_visible() significa siempre "fuera
--  de alcance", nunca "sin datos": por eso territorio.v_mapa ya no usa
--  coalesce(..., 0) y expone en cambio sin_acceso = (no hubo fila).
--
--  rol_reportes conserva su GRANT SELECT directo sobre la vista materializada:
--  es un rol de solo lectura para herramientas de BI que hoy no pasan por
--  DatabaseService.comoUsuario() ni fijan app.usuario_id, y forzarlas a pasar
--  por la función de seguridad las dejaría sin ver nada. Si en el futuro un
--  reporte con ese rol necesita respetar el alcance por usuario, se debe cerrar
--  en una migración aparte una vez se sepa cómo esa herramienta identifica al
--  usuario.
--
--  IMPORTANTE: el backend (territorio.repositorio.ts) también cambia en este
--  mismo commit: GET /territorio/mapa antes NO pasaba por comoUsuario(), así
--  que app.usuario_id nunca quedaba fijado y acceso.territorios_visibles()
--  veía una sesión vacía. Con esta migración sola (sin ese cambio) el mapa
--  habría quedado en blanco para todo el mundo, gerente incluido.
--
--  Requiere: 01 a 05. Se puede ejecutar más de una vez.
-- =============================================================================

BEGIN;

REVOKE SELECT ON campana.mv_conteo_territorio FROM rol_app;

CREATE OR REPLACE FUNCTION campana.conteo_territorio_visible()
RETURNS TABLE (territorio_id integer, simpatizantes integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
    SELECT c.territorio_id, c.simpatizantes
      FROM campana.mv_conteo_territorio c
     WHERE c.territorio_id IN (SELECT territorio_id FROM acceso.territorios_visibles());
$$;

REVOKE EXECUTE ON FUNCTION campana.conteo_territorio_visible() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION campana.conteo_territorio_visible() TO rol_app;

-- Mapa: sin_acceso = true cuando el territorio existe pero no hay fila en la
-- función de seguridad (fuera del alcance del usuario). El frontend lo pinta
-- en gris y no muestra número.
-- CREATE OR REPLACE VIEW solo permite agregar columnas al final sin romper la
-- vista: sin_acceso va después de geom, no junto a simpatizantes.
CREATE OR REPLACE VIEW territorio.v_mapa WITH (security_invoker = true) AS
SELECT t.id,
       t.tipo_codigo,
       t.nombre,
       t.padre_id,
       c.simpatizantes,
       (SELECT count(*) FROM territorio.territorios h WHERE h.padre_id = t.id) AS subdivisiones,
       t.geom,
       (c.territorio_id IS NULL) AS sin_acceso
  FROM territorio.territorios t
  LEFT JOIN campana.conteo_territorio_visible() c ON c.territorio_id = t.id;

-- Zonas sin cobertura: solo dentro del alcance del usuario (comparación
-- estricta = 0, no coalesce, para no confundir "0 simpatizantes" visible con
-- "fuera de alcance", que ahora llega como NULL).
CREATE OR REPLACE VIEW territorio.v_zonas_sin_cobertura WITH (security_invoker = true) AS
SELECT t.id, t.tipo_codigo, t.nombre,
       m.nombre AS municipio,
       t.geom
  FROM territorio.territorios t
  JOIN territorio.territorios m ON m.id = territorio.ancestro(t.id, 'MUNICIPIO')
  LEFT JOIN campana.conteo_territorio_visible() c ON c.territorio_id = t.id
 WHERE t.tipo_codigo IN ('BARRIO','VEREDA','CENTRO_POBLADO')
   AND c.simpatizantes = 0;

-- Avance de metas por territorio: sin acceso al territorio de la meta, no se
-- ve su avance (registrados/porcentaje quedan NULL).
CREATE OR REPLACE VIEW campana.v_avance_metas_territorio WITH (security_invoker = true) AS
SELECT mt.territorio_id,
       t.nombre AS territorio,
       mt.cantidad AS meta,
       mt.fecha_limite,
       c.simpatizantes AS registrados,
       round(100.0 * c.simpatizantes / mt.cantidad, 1) AS porcentaje
  FROM campana.metas_territorio mt
  JOIN territorio.territorios t ON t.id = mt.territorio_id
  LEFT JOIN campana.conteo_territorio_visible() c ON c.territorio_id = mt.territorio_id;

COMMIT;
