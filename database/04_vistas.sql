-- =============================================================================
--  04_vistas.sql
--  Vistas para tableros, mapas y reportes. Se calculan al consultarlas, así
--  que nunca se desactualizan ni duplican datos.
--
--  Todas usan security_invoker = true: respetan la seguridad por fila (RLS)
--  del usuario que consulta. Un líder que consulta una vista solo ve su red.
--
--  Excepción: la vista materializada mv_conteo_territorio guarda solo CONTEOS
--  (sin datos personales) para que el mapa cargue rápido.
--  Requiere: 01, 02 y 03
-- =============================================================================


-- =============================================================================
-- 1. TERRITORIO Y MAPA
-- =============================================================================

-- Cada territorio con su municipio, departamento y ruta completa.
CREATE VIEW territorio.v_jerarquia WITH (security_invoker = true) AS
SELECT t.id,
       t.tipo_codigo,
       tt.nivel,
       t.nombre,
       t.codigo_oficial,
       t.padre_id,
       territorio.ancestro(t.id, 'MUNICIPIO')    AS municipio_id,
       territorio.ancestro(t.id, 'DEPARTAMENTO') AS departamento_id,
       territorio.ruta(t.id)                     AS ruta,
       t.geom IS NOT NULL                        AS tiene_poligono,
       t.verificado
  FROM territorio.territorios t
  JOIN territorio.tipos_territorio tt ON tt.codigo = t.tipo_codigo;

-- Conteo de simpatizantes ACTIVOS por territorio, sumando todo lo que está
-- debajo (el total de Florencia incluye sus comunas, barrios y veredas).
-- Se refresca con: SELECT campana.refrescar_conteos();
CREATE MATERIALIZED VIEW campana.mv_conteo_territorio AS
WITH RECURSIVE subida AS (
    SELECT s.persona_id, t.id AS territorio_id, t.padre_id
      FROM campana.simpatizantes s
      JOIN territorio.territorios t ON t.id = s.territorio_residencia_id
     WHERE s.estado_codigo = 'ACTIVO'
    UNION ALL
    SELECT su.persona_id, p.id, p.padre_id
      FROM subida su JOIN territorio.territorios p ON p.id = su.padre_id
)
SELECT t.id AS territorio_id,
       count(su.persona_id)::integer AS simpatizantes
  FROM territorio.territorios t
  LEFT JOIN subida su ON su.territorio_id = t.id
 GROUP BY t.id
WITH DATA;

CREATE UNIQUE INDEX uq_mv_conteo_territorio ON campana.mv_conteo_territorio(territorio_id);

-- Capa lista para el mapa coroplético con drill-down:
--   nivel departamento: WHERE padre_id IS NULL
--   clic en Florencia:  WHERE padre_id = <id de Florencia>
CREATE VIEW territorio.v_mapa WITH (security_invoker = true) AS
SELECT t.id,
       t.tipo_codigo,
       t.nombre,
       t.padre_id,
       coalesce(c.simpatizantes, 0) AS simpatizantes,
       (SELECT count(*) FROM territorio.territorios h WHERE h.padre_id = t.id) AS subdivisiones,
       t.geom
  FROM territorio.territorios t
  LEFT JOIN campana.mv_conteo_territorio c ON c.territorio_id = t.id;

-- Veredas y barrios sin ningún simpatizante (zonas por trabajar).
CREATE VIEW territorio.v_zonas_sin_cobertura WITH (security_invoker = true) AS
SELECT t.id, t.tipo_codigo, t.nombre,
       m.nombre AS municipio,
       t.geom
  FROM territorio.territorios t
  JOIN territorio.territorios m ON m.id = territorio.ancestro(t.id, 'MUNICIPIO')
  LEFT JOIN campana.mv_conteo_territorio c ON c.territorio_id = t.id
 WHERE t.tipo_codigo IN ('BARRIO','VEREDA','CENTRO_POBLADO')
   AND coalesce(c.simpatizantes, 0) = 0;


-- =============================================================================
-- 2. SIMPATIZANTES Y RED
-- =============================================================================

CREATE VIEW campana.v_simpatizantes WITH (security_invoker = true) AS
SELECT s.persona_id,
       p.nombres,
       p.apellidos,
       s.territorio_residencia_id,
       res.nombre                  AS territorio_residencia,
       mun.id                      AS municipio_id,
       mun.nombre                  AS municipio,
       l.miembro_id                AS referido_por_miembro_id,
       pl.nombres || ' ' || pl.apellidos AS referido_por,
       s.canal_codigo,
       s.estado_codigo,
       s.capturado_en
  FROM campana.simpatizantes s
  JOIN personas.personas p          ON p.id = s.persona_id
  JOIN territorio.territorios res   ON res.id = s.territorio_residencia_id
  JOIN campana.links_referido l     ON l.id = s.link_referido_id
  JOIN campana.miembros m           ON m.id = l.miembro_id
  JOIN personas.personas pl         ON pl.id = m.persona_id
  LEFT JOIN territorio.territorios mun
         ON mun.id = territorio.ancestro(s.territorio_residencia_id, 'MUNICIPIO');

-- Árbol completo de la estructura de campaña.
CREATE VIEW campana.v_red_miembros WITH (security_invoker = true) AS
WITH RECURSIVE arbol AS (
    SELECT m.id, m.superior_id, m.cargo_codigo, m.persona_id, m.activo,
           1 AS profundidad,
           ARRAY[m.id] AS camino
      FROM campana.miembros m
     WHERE m.superior_id IS NULL
    UNION ALL
    SELECT h.id, h.superior_id, h.cargo_codigo, h.persona_id, h.activo,
           a.profundidad + 1,
           a.camino || h.id
      FROM campana.miembros h JOIN arbol a ON h.superior_id = a.id
)
SELECT a.id AS miembro_id,
       a.superior_id,
       a.cargo_codigo,
       p.nombres || ' ' || p.apellidos AS nombre,
       a.activo,
       a.profundidad,
       a.camino
  FROM arbol a
  JOIN personas.personas p ON p.id = a.persona_id;

-- Desempeño de cada miembro: registros directos, calidad y actividad.
CREATE VIEW campana.v_ranking_miembros WITH (security_invoker = true) AS
SELECT m.id AS miembro_id,
       p.nombres || ' ' || p.apellidos AS nombre,
       m.cargo_codigo,
       count(s.persona_id) FILTER (WHERE s.estado_codigo = 'ACTIVO')                 AS activos,
       count(s.persona_id) FILTER (WHERE s.capturado_en > now() - interval '7 days') AS ultimos_7_dias,
       max(s.capturado_en)                                                            AS ultimo_registro,
       (SELECT count(*) FROM calidad.intentos_duplicado i
          JOIN campana.links_referido li ON li.id = i.link_referido_id
         WHERE li.miembro_id = m.id)                                                  AS intentos_duplicado
  FROM campana.miembros m
  JOIN personas.personas p ON p.id = m.persona_id
  LEFT JOIN campana.links_referido l ON l.miembro_id = m.id
  LEFT JOIN campana.simpatizantes s  ON s.link_referido_id = l.id
 WHERE m.activo
 GROUP BY m.id, p.nombres, p.apellidos, m.cargo_codigo;

-- Líderes sin registros en los últimos N días (parámetro LIDER_INACTIVO_DIAS).
CREATE VIEW campana.v_lideres_inactivos WITH (security_invoker = true) AS
SELECT r.*
  FROM campana.v_ranking_miembros r
 WHERE r.cargo_codigo IN ('LIDER','SUBLIDER')
   AND (r.ultimo_registro IS NULL
        OR r.ultimo_registro < now() - make_interval(days => campana.parametro_int('LIDER_INACTIVO_DIAS')));

-- Crecimiento diario por municipio (para la gráfica de avance).
CREATE VIEW campana.v_registros_diarios WITH (security_invoker = true) AS
SELECT s.capturado_en::date AS fecha,
       territorio.ancestro(s.territorio_residencia_id, 'MUNICIPIO') AS municipio_id,
       s.canal_codigo,
       count(*) AS registros
  FROM campana.simpatizantes s
 GROUP BY 1, 2, 3;

CREATE VIEW campana.v_avance_metas_miembro WITH (security_invoker = true) AS
SELECT mm.miembro_id,
       mm.cantidad AS meta,
       mm.fecha_inicio,
       mm.fecha_limite,
       count(s.persona_id) AS registrados,
       round(100.0 * count(s.persona_id) / mm.cantidad, 1) AS porcentaje
  FROM campana.metas_miembro mm
  JOIN campana.links_referido l ON l.miembro_id = mm.miembro_id
  LEFT JOIN campana.simpatizantes s
         ON s.link_referido_id = l.id
        AND s.estado_codigo = 'ACTIVO'
        AND s.capturado_en::date BETWEEN mm.fecha_inicio AND mm.fecha_limite
 GROUP BY mm.id, mm.miembro_id, mm.cantidad, mm.fecha_inicio, mm.fecha_limite;

CREATE VIEW campana.v_avance_metas_territorio WITH (security_invoker = true) AS
SELECT mt.territorio_id,
       t.nombre AS territorio,
       mt.cantidad AS meta,
       mt.fecha_limite,
       coalesce(c.simpatizantes, 0) AS registrados,
       round(100.0 * coalesce(c.simpatizantes, 0) / mt.cantidad, 1) AS porcentaje
  FROM campana.metas_territorio mt
  JOIN territorio.territorios t ON t.id = mt.territorio_id
  LEFT JOIN campana.mv_conteo_territorio c ON c.territorio_id = mt.territorio_id;

-- Indicadores del tablero principal.
CREATE VIEW campana.v_tablero WITH (security_invoker = true) AS
SELECT
    (SELECT count(*) FROM campana.simpatizantes WHERE estado_codigo = 'ACTIVO')              AS simpatizantes_activos,
    (SELECT count(*) FROM campana.simpatizantes WHERE capturado_en::date = current_date)     AS registros_hoy,
    (SELECT count(*) FROM campana.simpatizantes WHERE capturado_en > now() - interval '7 days') AS registros_semana,
    (SELECT count(*) FROM campana.miembros WHERE activo)                                     AS miembros_activos,
    (SELECT count(*) FROM calidad.alertas WHERE estado IN ('ABIERTA','EN_REVISION'))         AS alertas_abiertas,
    (SELECT count(*) FROM participacion.necesidades)                                         AS necesidades_reportadas;


-- =============================================================================
-- 3. ELECTORAL
-- =============================================================================

-- Brecha electoral: simpatizantes frente al potencial de cada puesto.
CREATE VIEW electoral.v_brecha_puestos WITH (security_invoker = true) AS
SELECT pv.id AS puesto_id,
       pv.nombre AS puesto,
       territorio.ancestro(pv.territorio_id, 'MUNICIPIO') AS municipio_id,
       pj.jornada_id,
       pj.potencial_electoral,
       count(sp.persona_id) AS simpatizantes,
       CASE WHEN pj.potencial_electoral > 0
            THEN round(100.0 * count(sp.persona_id) / pj.potencial_electoral, 2) END AS cobertura_pct,
       pv.geom
  FROM electoral.puestos_votacion pv
  JOIN electoral.puestos_jornada pj ON pj.puesto_id = pv.id
  LEFT JOIN campana.simpatizante_puesto sp
         ON sp.puesto_id = pj.puesto_id AND sp.jornada_id = pj.jornada_id
 GROUP BY pv.id, pv.nombre, pv.territorio_id, pj.jornada_id, pj.potencial_electoral, pv.geom;

-- De dónde vienen los votantes de cada puesto (qué barrios/veredas).
CREATE VIEW electoral.v_origen_votantes_puesto WITH (security_invoker = true) AS
SELECT sp.jornada_id,
       sp.puesto_id,
       s.territorio_residencia_id,
       count(*) AS simpatizantes
  FROM campana.simpatizante_puesto sp
  JOIN campana.simpatizantes s ON s.persona_id = sp.persona_id AND s.estado_codigo = 'ACTIVO'
 GROUP BY sp.jornada_id, sp.puesto_id, s.territorio_residencia_id;

-- Cobertura de testigos por puesto.
CREATE VIEW electoral.v_cobertura_testigos WITH (security_invoker = true) AS
SELECT m.jornada_id,
       m.puesto_id,
       pv.nombre AS puesto,
       count(DISTINCT m.id)                                         AS mesas,
       count(DISTINCT t.mesa_id)                                    AS mesas_con_testigo,
       count(DISTINCT m.id) - count(DISTINCT t.mesa_id)             AS mesas_sin_testigo
  FROM electoral.mesas m
  JOIN electoral.puestos_votacion pv ON pv.id = m.puesto_id
  LEFT JOIN electoral.testigos t ON t.mesa_id = m.id AND t.estado <> 'AUSENTE'
 GROUP BY m.jornada_id, m.puesto_id, pv.nombre;

-- Conteo rápido con los E-14 validados.
CREATE VIEW electoral.v_conteo_rapido WITH (security_invoker = true) AS
SELECT ov.jornada_id,
       ov.corporacion_codigo,
       ov.nombre AS opcion,
       ov.es_candidato_propio,
       sum(r.votos) AS votos,
       count(DISTINCT f.mesa_id) AS mesas_reportadas
  FROM electoral.resultados_e14 r
  JOIN electoral.formularios_e14 f ON f.id = r.formulario_id AND f.estado_revision = 'VALIDADO'
  JOIN electoral.opciones_voto ov  ON ov.id = r.opcion_voto_id
 GROUP BY ov.jornada_id, ov.corporacion_codigo, ov.nombre, ov.es_candidato_propio;


-- =============================================================================
-- 4. PARTICIPACIÓN
-- =============================================================================

-- Necesidades por municipio y categoría (usa la categoría humana o, si no hay,
-- la sugerencia de IA con mayor confianza).
CREATE VIEW participacion.v_necesidades_municipio WITH (security_invoker = true) AS
WITH categorizada AS (
    SELECT n.id, n.territorio_id,
           coalesce(n.categoria_codigo,
                    (SELECT c.categoria_codigo FROM participacion.clasificaciones_ia c
                      WHERE c.necesidad_id = n.id ORDER BY c.confianza DESC LIMIT 1),
                    'OTRA') AS categoria_codigo
      FROM participacion.necesidades n
)
SELECT territorio.ancestro(c.territorio_id, 'MUNICIPIO') AS municipio_id,
       c.categoria_codigo,
       count(*) AS cantidad
  FROM categorizada c
 GROUP BY 1, 2;

-- Categorías con necesidades reportadas pero sin ninguna propuesta publicada.
CREATE VIEW participacion.v_necesidades_sin_propuesta WITH (security_invoker = true) AS
SELECT cn.codigo, cn.nombre, sum(nm.cantidad) AS necesidades
  FROM participacion.v_necesidades_municipio nm
  JOIN participacion.categorias_necesidad cn ON cn.codigo = nm.categoria_codigo
 WHERE NOT EXISTS (
        SELECT 1 FROM participacion.propuesta_categorias pc
          JOIN participacion.propuestas p ON p.id = pc.propuesta_id AND p.publicada
         WHERE pc.categoria_codigo = cn.codigo)
 GROUP BY cn.codigo, cn.nombre;


-- =============================================================================
-- 5. EVENTOS Y COMUNICACIONES
-- =============================================================================

CREATE VIEW eventos.v_resumen_eventos WITH (security_invoker = true) AS
SELECT e.id, e.nombre, e.tipo_codigo, e.inicia_en,
       t.nombre AS territorio,
       count(a.persona_id) AS asistentes,
       count(s.persona_id) AS asistentes_simpatizantes,
       count(s.persona_id) FILTER (WHERE s.canal_codigo = 'EVENTO'
                                     AND s.capturado_en BETWEEN e.inicia_en AND e.termina_en) AS registrados_en_evento
  FROM eventos.eventos e
  JOIN territorio.territorios t ON t.id = e.territorio_id
  LEFT JOIN eventos.asistencias a  ON a.evento_id = e.id
  LEFT JOIN campana.simpatizantes s ON s.persona_id = a.persona_id
 GROUP BY e.id, e.nombre, e.tipo_codigo, e.inicia_en, t.nombre;

-- Personas a las que se les puede escribir por cada canal.
CREATE VIEW comunicaciones.v_contactables WITH (security_invoker = true) AS
SELECT DISTINCT a.persona_id, c.codigo AS canal_codigo
  FROM cumplimiento.autorizaciones a
  JOIN cumplimiento.autorizacion_finalidades af
    ON af.autorizacion_id = a.id AND af.finalidad_codigo = 'COMUNICACIONES'
 CROSS JOIN comunicaciones.canales c
 WHERE a.revocada_en IS NULL
   AND NOT EXISTS (SELECT 1 FROM comunicaciones.bajas b
                    WHERE b.persona_id = a.persona_id AND b.canal_codigo = c.codigo);

CREATE VIEW comunicaciones.v_resumen_envios WITH (security_invoker = true) AS
SELECT e.id, pl.nombre AS plantilla, pl.canal_codigo, e.programado_para, e.estado,
       count(d.persona_id)                                              AS destinatarios,
       count(d.persona_id) FILTER (WHERE d.estado = 'ENVIADO')          AS enviados,
       count(d.persona_id) FILTER (WHERE d.estado = 'FALLIDO')          AS fallidos,
       count(d.persona_id) FILTER (WHERE d.estado = 'OMITIDO_SIN_AUTORIZACION') AS omitidos
  FROM comunicaciones.envios e
  JOIN comunicaciones.plantillas pl ON pl.id = e.plantilla_id
  LEFT JOIN comunicaciones.envio_destinatarios d ON d.envio_id = e.id
 GROUP BY e.id, pl.nombre, pl.canal_codigo, e.programado_para, e.estado;


-- =============================================================================
-- 6. CUMPLIMIENTO Y CALIDAD
-- =============================================================================

-- Solicitudes de titulares con fecha límite en días hábiles (con festivos).
CREATE VIEW cumplimiento.v_solicitudes_plazos WITH (security_invoker = true) AS
SELECT s.id,
       s.radicado,
       s.tipo_codigo,
       s.estado,
       s.recibida_en,
       cumplimiento.sumar_dias_habiles(s.recibida_en::date, t.plazo_dias_habiles) AS fecha_limite,
       CASE
           WHEN s.estado IN ('RESPONDIDA','RECHAZADA') THEN 'CERRADA'
           WHEN current_date > cumplimiento.sumar_dias_habiles(s.recibida_en::date, t.plazo_dias_habiles) THEN 'VENCIDA'
           WHEN current_date > cumplimiento.sumar_dias_habiles(s.recibida_en::date, t.plazo_dias_habiles - 3) THEN 'POR_VENCER'
           ELSE 'EN_PLAZO'
       END AS semaforo
  FROM cumplimiento.solicitudes_titular s
  JOIN cumplimiento.tipos_solicitud t ON t.codigo = s.tipo_codigo;

-- Control: simpatizantes activos sin autorización vigente (debería estar vacía).
CREATE VIEW cumplimiento.v_control_autorizaciones WITH (security_invoker = true) AS
SELECT s.persona_id, s.estado_codigo, s.capturado_en
  FROM campana.simpatizantes s
 WHERE s.estado_codigo = 'ACTIVO'
   AND NOT EXISTS (
        SELECT 1 FROM cumplimiento.autorizaciones a
          JOIN cumplimiento.autorizacion_finalidades af ON af.autorizacion_id = a.id
         WHERE a.persona_id = s.persona_id AND a.revocada_en IS NULL
           AND af.finalidad_codigo = 'ORGANIZACION_CAMPANA');

CREATE VIEW calidad.v_alertas_abiertas WITH (security_invoker = true) AS
SELECT a.id, a.tipo_codigo, ta.severidad, a.estado, a.detectada_en, a.observacion,
       (SELECT count(*) FROM calidad.alerta_personas ap WHERE ap.alerta_id = a.id) AS personas,
       (SELECT count(*) FROM calidad.alerta_miembros am WHERE am.alerta_id = a.id) AS miembros
  FROM calidad.alertas a
  JOIN calidad.tipos_alerta ta ON ta.codigo = a.tipo_codigo
 WHERE a.estado IN ('ABIERTA','EN_REVISION');


-- =============================================================================
-- 7. ACCESO Y AUDITORÍA
-- =============================================================================

CREATE VIEW acceso.v_permisos_usuarios WITH (security_invoker = true) AS
SELECT u.id AS usuario_id, u.login, ur.rol_codigo, rp.permiso_codigo
  FROM acceso.usuarios u
  JOIN acceso.usuario_roles ur ON ur.usuario_id = u.id
  JOIN acceso.rol_permisos rp ON rp.rol_codigo = ur.rol_codigo
 WHERE u.activo;

CREATE VIEW auditoria.v_actividad_usuarios WITH (security_invoker = true) AS
SELECT e.usuario_id, u.login, e.accion,
       e.ocurrido_en::date AS fecha,
       count(*) AS eventos
  FROM auditoria.eventos e
  LEFT JOIN acceso.usuarios u ON u.id = e.usuario_id
 GROUP BY e.usuario_id, u.login, e.accion, e.ocurrido_en::date;
