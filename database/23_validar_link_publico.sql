-- =============================================================================
--  23_validar_link_publico.sql
--  Corrige el formulario público de registro (/r/<código>): siempre decía
--  "Este enlace no está activo".
--
--  Causa: GET /api/registro/link/:codigo se consulta sin usuario (visitante
--  anónimo) y leía el nombre del líder en personas.personas. La política
--  p_personas_lectura solo deja ver a un anónimo las personas que son
--  simpatizantes, y un líder normalmente no lo es: la consulta no devolvía
--  nada y la API respondía { valido: false }.
--
--  Corrección: una función SECURITY DEFINER que valida el enlace y devuelve
--  solo el primer nombre del líder (lo único que muestra el formulario). No
--  abre la tabla personas a los anónimos.
--  Requiere: 01 a 21. Se puede ejecutar más de una vez.
-- =============================================================================

CREATE OR REPLACE FUNCTION campana.lider_de_link(p_codigo text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
    SELECT split_part(btrim(p.nombres), ' ', 1)
      FROM campana.links_referido l
      JOIN campana.miembros m        ON m.id = l.miembro_id
      JOIN personas.personas p       ON p.id = m.persona_id
     WHERE l.codigo = upper(btrim(p_codigo))
       AND l.activo
       AND m.activo
       AND (l.expira_en IS NULL OR l.expira_en > now())
     LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION campana.lider_de_link(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION campana.lider_de_link(text) TO rol_app;
