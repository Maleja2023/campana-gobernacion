-- =============================================================================
--  32_necesidades_ia.sql
--  Voz del territorio con inteligencia artificial:
--    - Clasificación automática de las necesidades sin categoría (vías, agua,
--      salud, empleo, educación, seguridad...). La API las clasifica con IA
--      (o, si no hay IA configurada, con reglas por palabras clave) y guarda
--      el resultado en participacion.clasificaciones_ia.
--    - Corrección manual de la categoría (manda sobre la IA).
--    - Listado de necesidades para la pantalla, SIN datos de la persona.
--    - Informes por municipio (insumo para el programa de gobierno),
--      guardados para no regenerarlos en cada consulta.
--
--  Protección de datos: lo que se envía a la IA es solo el texto de la
--  necesidad (con números largos y correos borrados en la API) y el nombre
--  del municipio. Nunca nombres, cédulas ni teléfonos de simpatizantes.
--
--  Requiere: 01 a 31. Se puede ejecutar más de una vez.
-- =============================================================================

BEGIN;

-- Categoría final de una necesidad: la de origen (o la corregida a mano) y,
-- si no tiene, la clasificación automática más reciente y de mayor confianza.
CREATE OR REPLACE FUNCTION participacion.categoria_final(p_necesidad_id uuid, p_categoria_origen text)
RETURNS TABLE (categoria text, fuente text, confianza numeric, modelo text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
    SELECT p_categoria_origen, 'ORIGEN', 1.0::numeric, NULL::text WHERE p_categoria_origen IS NOT NULL
    UNION ALL
    (SELECT c.categoria_codigo,
            CASE WHEN c.modelo LIKE 'reglas%' THEN 'REGLAS' ELSE 'IA' END,
            c.confianza, c.modelo
       FROM participacion.clasificaciones_ia c
      WHERE p_categoria_origen IS NULL AND c.necesidad_id = p_necesidad_id
      ORDER BY c.confianza DESC, c.clasificada_en DESC
      LIMIT 1);
$$;
GRANT EXECUTE ON FUNCTION participacion.categoria_final(uuid, text) TO rol_app;

-- Pendientes de clasificar con un modelo (tarea programada, sin usuario).
CREATE OR REPLACE FUNCTION participacion.necesidades_por_clasificar(p_modelo text, p_limite integer)
RETURNS TABLE (necesidad_id uuid, descripcion text, municipio text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
    SELECT n.id, n.descripcion, m.nombre
      FROM participacion.necesidades n
      LEFT JOIN territorio.territorios m ON m.id = territorio.ancestro(n.territorio_id, 'MUNICIPIO')
     WHERE n.categoria_codigo IS NULL
       AND NOT EXISTS (SELECT 1 FROM participacion.clasificaciones_ia c
                        WHERE c.necesidad_id = n.id AND c.modelo = p_modelo)
     ORDER BY n.reportada_en DESC
     LIMIT least(greatest(p_limite, 1), 200);
$$;
REVOKE EXECUTE ON FUNCTION participacion.necesidades_por_clasificar(text, integer) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION participacion.necesidades_por_clasificar(text, integer) TO rol_app;

CREATE OR REPLACE FUNCTION participacion.guardar_clasificacion(p_necesidad_id uuid, p_categoria text, p_modelo text, p_confianza numeric)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
    INSERT INTO participacion.clasificaciones_ia (necesidad_id, categoria_codigo, modelo, confianza)
    VALUES (p_necesidad_id, p_categoria, p_modelo, least(greatest(p_confianza, 0), 1))
    ON CONFLICT (necesidad_id, modelo, categoria_codigo)
    DO UPDATE SET confianza = EXCLUDED.confianza, clasificada_en = now();
$$;
REVOKE EXECUTE ON FUNCTION participacion.guardar_clasificacion(uuid, text, text, numeric) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION participacion.guardar_clasificacion(uuid, text, text, numeric) TO rol_app;

-- Cifras del avance de la clasificación (solo conteos).
CREATE OR REPLACE FUNCTION participacion.estado_clasificacion(p_modelo text)
RETURNS TABLE (total integer, con_categoria_origen integer, clasificadas_modelo integer,
               clasificadas_reglas integer, pendientes_modelo integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
    SELECT count(*)::integer,
           count(*) FILTER (WHERE n.categoria_codigo IS NOT NULL)::integer,
           count(*) FILTER (WHERE n.categoria_codigo IS NULL AND EXISTS (
               SELECT 1 FROM participacion.clasificaciones_ia c WHERE c.necesidad_id = n.id AND c.modelo = p_modelo))::integer,
           count(*) FILTER (WHERE n.categoria_codigo IS NULL AND EXISTS (
               SELECT 1 FROM participacion.clasificaciones_ia c WHERE c.necesidad_id = n.id AND c.modelo LIKE 'reglas%'))::integer,
           count(*) FILTER (WHERE n.categoria_codigo IS NULL AND NOT EXISTS (
               SELECT 1 FROM participacion.clasificaciones_ia c WHERE c.necesidad_id = n.id AND c.modelo = p_modelo))::integer
      FROM participacion.necesidades n
     WHERE n.territorio_id IN (SELECT territorio_id FROM acceso.territorios_visibles())
        OR acceso.usuario_actual() IS NULL;
$$;
REVOKE EXECUTE ON FUNCTION participacion.estado_clasificacion(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION participacion.estado_clasificacion(text) TO rol_app;

-- Listado para la pantalla: nunca devuelve quién reportó la necesidad.
CREATE OR REPLACE FUNCTION participacion.listado_necesidades(p_municipio_id integer, p_categoria text, p_limite integer, p_desplazamiento integer)
RETURNS TABLE (necesidad_id uuid, descripcion text, territorio text, tipo_territorio text, municipio text,
               categoria text, fuente_categoria text, confianza numeric, origen text, prioridad text,
               reportada_en timestamptz, total bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
    WITH base AS (
        SELECT n.id, n.descripcion, n.origen, n.prioridad, n.reportada_en, n.territorio_id,
               t.nombre AS territorio, t.tipo_codigo, m.id AS municipio_id, m.nombre AS municipio,
               cf.categoria, cf.fuente, cf.confianza
          FROM participacion.necesidades n
          JOIN territorio.territorios t ON t.id = n.territorio_id
          LEFT JOIN territorio.territorios m ON m.id = territorio.ancestro(n.territorio_id, 'MUNICIPIO')
          LEFT JOIN LATERAL participacion.categoria_final(n.id, n.categoria_codigo) cf ON true
    ), filtrada AS (
        SELECT * FROM base
         WHERE (p_municipio_id IS NULL OR municipio_id = p_municipio_id)
           AND (p_categoria IS NULL OR coalesce(categoria, 'SIN_CLASIFICAR') = p_categoria)
    )
    SELECT id, descripcion, territorio, tipo_codigo, municipio, categoria, fuente, confianza, origen, prioridad,
           reportada_en, count(*) OVER ()
      FROM filtrada
     ORDER BY reportada_en DESC
     LIMIT least(greatest(p_limite, 1), 200) OFFSET greatest(p_desplazamiento, 0);
$$;
GRANT EXECUTE ON FUNCTION participacion.listado_necesidades(integer, text, integer, integer) TO rol_app;

-- Resumen por municipio y categoría (con la categoría final).
CREATE OR REPLACE FUNCTION participacion.resumen_necesidades()
RETURNS TABLE (municipio_id integer, municipio text, categoria text, cantidad integer)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
    SELECT m.id, m.nombre, coalesce(cf.categoria, 'SIN_CLASIFICAR'), count(*)::integer
      FROM participacion.necesidades n
      LEFT JOIN territorio.territorios m ON m.id = territorio.ancestro(n.territorio_id, 'MUNICIPIO')
      LEFT JOIN LATERAL participacion.categoria_final(n.id, n.categoria_codigo) cf ON true
     GROUP BY m.id, m.nombre, coalesce(cf.categoria, 'SIN_CLASIFICAR');
$$;
GRANT EXECUTE ON FUNCTION participacion.resumen_necesidades() TO rol_app;

-- Corrección manual: fija la categoría de origen (manda sobre la IA). Solo
-- quien gestiona la agenda y sobre necesidades de su territorio.
CREATE OR REPLACE FUNCTION participacion.corregir_categoria(p_necesidad_id uuid, p_categoria text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
    IF NOT acceso.tiene_permiso('AGENDA_GESTIONAR') THEN
        RAISE EXCEPTION 'Sin permiso para corregir la categoría' USING ERRCODE = '42501';
    END IF;
    UPDATE participacion.necesidades n
       SET categoria_codigo = p_categoria
     WHERE n.id = p_necesidad_id
       AND n.territorio_id IN (SELECT territorio_id FROM acceso.territorios_visibles());
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Necesidad no encontrada';
    END IF;
END $$;
REVOKE EXECUTE ON FUNCTION participacion.corregir_categoria(uuid, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION participacion.corregir_categoria(uuid, text) TO rol_app;

-- Insumo del informe de un municipio: textos y lugar, sin la persona.
CREATE OR REPLACE FUNCTION participacion.insumo_informe(p_municipio_id integer)
RETURNS TABLE (categoria text, territorio text, descripcion text, prioridad text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
    SELECT coalesce(cf.categoria, 'SIN_CLASIFICAR'), t.nombre, n.descripcion, n.prioridad
      FROM participacion.necesidades n
      JOIN territorio.territorios t ON t.id = n.territorio_id
      LEFT JOIN LATERAL participacion.categoria_final(n.id, n.categoria_codigo) cf ON true
     WHERE territorio.ancestro(n.territorio_id, 'MUNICIPIO') = p_municipio_id
     ORDER BY n.reportada_en DESC
     LIMIT 400;
$$;
GRANT EXECUTE ON FUNCTION participacion.insumo_informe(integer) TO rol_app;

CREATE TABLE IF NOT EXISTS participacion.informes_necesidades (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    municipio_id      integer NOT NULL REFERENCES territorio.territorios(id),
    generado_en       timestamptz NOT NULL DEFAULT now(),
    generado_por      uuid NOT NULL REFERENCES acceso.usuarios(id),
    modelo            text NOT NULL,
    total_necesidades integer NOT NULL,
    contenido         text NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_informes_municipio ON participacion.informes_necesidades (municipio_id, generado_en DESC);

ALTER TABLE participacion.informes_necesidades ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_informes_territorio ON participacion.informes_necesidades;
CREATE POLICY p_informes_territorio ON participacion.informes_necesidades
    USING (municipio_id IN (SELECT territorio_id FROM acceso.territorios_visibles()))
    WITH CHECK (municipio_id IN (SELECT territorio_id FROM acceso.territorios_visibles())
                AND generado_por = acceso.usuario_actual());
GRANT SELECT, INSERT ON participacion.informes_necesidades TO rol_app;
GRANT USAGE ON SCHEMA participacion TO rol_app;

COMMIT;
