-- =============================================================================
--  08_datos_demo.sql  (OPCIONAL – SOLO PARA PRUEBAS Y DEMOSTRACIONES)
--  Crea una estructura de campaña ficticia y ~800 simpatizantes inventados,
--  repartidos en veredas, barrios y comunas reales del Caquetá.
--
--  NUNCA ejecutar en la base de producción. Todos los documentos y teléfonos
--  son falsos y están marcados como DEMO.
--  Requiere: 01 a 07
-- =============================================================================

BEGIN;

-- Política de tratamiento de datos de prueba
INSERT INTO cumplimiento.politicas_tratamiento (version, texto, hash_texto, vigente_desde)
VALUES (1, 'Política de tratamiento de datos (texto de prueba)',
        digest('Política de tratamiento de datos (texto de prueba)', 'sha256'), current_date - 90);
INSERT INTO cumplimiento.politica_finalidades (politica_version, finalidad_codigo)
SELECT 1, codigo FROM cumplimiento.finalidades;

-- Evita alertas de "registro masivo" mientras se cargan datos de golpe
UPDATE campana.parametros SET valor = '1000000' WHERE clave = 'REGISTRO_MASIVO_UMBRAL';

DO $$
DECLARE
    v_nombres   text[] := ARRAY['MARÍA','JOSÉ','LUZ','CARLOS','ANA','JUAN','DIANA','LUIS','SANDRA',
                                'JORGE','PAOLA','ANDRÉS','YENNY','WILSON','CLAUDIA','FREDY','MARTHA','EDWIN'];
    v_apellidos text[] := ARRAY['GÓMEZ','RODRÍGUEZ','MARTÍNEZ','LÓPEZ','GARCÍA','PÉREZ','SÁNCHEZ',
                                'RAMÍREZ','TORRES','VARGAS','MUÑOZ','ROJAS','DÍAZ','CUELLAR','PENAGOS'];
    v_doc          bigint := 1000000000;
    v_gerente      uuid;
    v_coord        uuid;
    v_lider        uuid;
    v_persona      uuid;
    v_usuario      uuid;
    v_jornada      smallint;
    v_depto        integer;
    v_mun          record;
    v_territorio   integer;
    v_puesto       integer;
    v_link         text;
    v_i            integer;
    v_r            record;
    v_telefono     text;
    v_categorias   text[] := ARRAY['VIAS','AGUA','SALUD','EDUCACION','EMPLEO','SEGURIDAD','AGRO','CONECTIVIDAD'];
    v_necesidades  text[] := ARRAY['La vía está en mal estado','No hay acueducto','Falta puesto de salud',
                                   'La escuela necesita arreglos','No hay empleo para jóvenes',
                                   'Inseguridad en la noche','Apoyo para cultivos','No hay señal de internet'];
BEGIN
    SELECT id INTO v_jornada FROM electoral.jornadas WHERE nombre = 'Territoriales 2023';
    SELECT id INTO v_depto   FROM territorio.territorios WHERE tipo_codigo = 'DEPARTAMENTO';

    -- Función local para crear personas del equipo
    -- (persona + miembro; el link principal lo crea el trigger)
    v_doc := v_doc + 1;
    INSERT INTO personas.personas (tipo_documento_codigo, documento_hash, documento_cifrado, nombres, apellidos)
    VALUES ('CC', hmac(v_doc::text, 'demo', 'sha256'), convert_to('DEMO-' || v_doc, 'UTF8'), 'Gerente', 'Demo')
    RETURNING id INTO v_persona;
    INSERT INTO campana.miembros (persona_id, cargo_codigo) VALUES (v_persona, 'GERENTE') RETURNING id INTO v_gerente;
    INSERT INTO acceso.usuarios (persona_id, login, password_hash)
    VALUES (v_persona, 'gerente@demo.co', 'NO-USAR') RETURNING id INTO v_usuario;
    INSERT INTO acceso.usuario_roles VALUES (v_usuario, 'GERENTE');
    INSERT INTO acceso.usuario_territorios VALUES (v_usuario, v_depto);

    -- Coordinadores y líderes en 4 municipios
    FOR v_mun IN
        SELECT t.id, t.nombre, x.lideres, x.simpatizantes
          FROM territorio.territorios t
          JOIN (VALUES ('18001', 5, 350), ('18753', 3, 200), ('18592', 2, 130), ('18247', 2, 120))
               AS x(cod, lideres, simpatizantes) ON x.cod = t.codigo_oficial
    LOOP
        v_doc := v_doc + 1;
        INSERT INTO personas.personas (tipo_documento_codigo, documento_hash, documento_cifrado, nombres, apellidos)
        VALUES ('CC', hmac(v_doc::text, 'demo', 'sha256'), convert_to('DEMO-' || v_doc, 'UTF8'),
                'Coordinador', v_mun.nombre)
        RETURNING id INTO v_persona;
        INSERT INTO campana.miembros (persona_id, cargo_codigo, superior_id)
        VALUES (v_persona, 'COORDINADOR', v_gerente) RETURNING id INTO v_coord;
        INSERT INTO campana.miembro_territorios VALUES (v_coord, v_mun.id);
        INSERT INTO acceso.usuarios (persona_id, login, password_hash)
        VALUES (v_persona, 'coord.' || lower(replace(util.sin_tildes(v_mun.nombre), ' ', '')) || '@demo.co', 'NO-USAR')
        RETURNING id INTO v_usuario;
        INSERT INTO acceso.usuario_roles VALUES (v_usuario, 'COORDINADOR');
        INSERT INTO acceso.usuario_territorios VALUES (v_usuario, v_mun.id);

        FOR n IN 1 .. v_mun.lideres LOOP
            v_doc := v_doc + 1;
            INSERT INTO personas.personas (tipo_documento_codigo, documento_hash, documento_cifrado, nombres, apellidos)
            VALUES ('CC', hmac(v_doc::text, 'demo', 'sha256'), convert_to('DEMO-' || v_doc, 'UTF8'),
                    'Líder ' || n, v_mun.nombre)
            RETURNING id INTO v_persona;
            INSERT INTO campana.miembros (persona_id, cargo_codigo, superior_id)
            VALUES (v_persona, 'LIDER', v_coord) RETURNING id INTO v_lider;
            INSERT INTO campana.metas_miembro (miembro_id, cantidad, fecha_inicio, fecha_limite)
            VALUES (v_lider, 120, current_date - 90, current_date + 300);
            INSERT INTO acceso.usuarios (persona_id, login, password_hash)
            VALUES (v_persona, 'lider' || n || '.' || lower(replace(util.sin_tildes(v_mun.nombre), ' ', '')) || '@demo.co', 'NO-USAR')
            RETURNING id INTO v_usuario;
            INSERT INTO acceso.usuario_roles VALUES (v_usuario, 'LIDER');
        END LOOP;

        INSERT INTO campana.metas_territorio (territorio_id, cantidad, fecha_inicio, fecha_limite)
        VALUES (v_mun.id, v_mun.simpatizantes * 3, current_date - 90, current_date + 300);

        -- Simpatizantes del municipio, repartidos entre sus líderes
        FOR v_i IN 1 .. v_mun.simpatizantes LOOP
            v_doc := v_doc + 1;

            SELECT l.codigo INTO v_link
              FROM campana.links_referido l
              JOIN campana.miembros m ON m.id = l.miembro_id
             WHERE m.superior_id = v_coord AND l.es_principal
             ORDER BY random() LIMIT 1;

            SELECT d.territorio_id INTO v_territorio
              FROM territorio.descendientes(v_mun.id) d
             ORDER BY random() LIMIT 1;

            SELECT pv.id INTO v_puesto
              FROM electoral.puestos_votacion pv
             WHERE territorio.ancestro(pv.territorio_id, 'MUNICIPIO') = v_mun.id
             ORDER BY random() LIMIT 1;

            -- unos pocos teléfonos repetidos a propósito (para ver alertas)
            v_telefono := CASE WHEN v_i % 97 = 0 THEN '3100000000' ELSE '31' || (10000000 + v_doc % 89999999) END;

            PERFORM * FROM campana.registrar_simpatizante(
                'CC', hmac(v_doc::text, 'demo', 'sha256'), convert_to('DEMO-' || v_doc, 'UTF8'),
                v_nombres[1 + floor(random() * array_length(v_nombres, 1))::int],
                v_apellidos[1 + floor(random() * array_length(v_apellidos, 1))::int] || ' ' ||
                v_apellidos[1 + floor(random() * array_length(v_apellidos, 1))::int],
                hmac(v_telefono, 'demo', 'sha256'), convert_to('DEMO-' || v_telefono, 'UTF8'),
                v_territorio, v_link,
                (ARRAY['FORMULARIO_WEB','CHATBOT_WEB','DIGITADOR'])[1 + floor(random() * 3)::int],
                1::smallint,
                CASE WHEN random() < 0.7
                     THEN ARRAY['ORGANIZACION_CAMPANA','COMUNICACIONES']
                     ELSE ARRAY['ORGANIZACION_CAMPANA'] END,
                'Casilla de autorización marcada (demo)',
                now() - (random() * interval '75 days'),
                v_jornada, v_puesto,
                CASE WHEN random() < 0.3 THEN v_necesidades[1 + floor(random() * 8)::int] END,
                NULL);
        END LOOP;
    END LOOP;

    -- Intentos de duplicado: 10 personas que otro líder intenta registrar de nuevo
    FOR v_r IN
        SELECT p.documento_hash, p.documento_cifrado, p.nombres, p.apellidos, s.territorio_residencia_id,
               (SELECT l2.codigo FROM campana.links_referido l2
                 WHERE l2.es_principal AND l2.miembro_id <> l.miembro_id
                   AND l2.miembro_id IN (SELECT id FROM campana.miembros WHERE cargo_codigo = 'LIDER')
                 ORDER BY random() LIMIT 1) AS otro_link
          FROM campana.simpatizantes s
          JOIN personas.personas p ON p.id = s.persona_id
          JOIN campana.links_referido l ON l.id = s.link_referido_id
         ORDER BY random() LIMIT 10
    LOOP
        PERFORM * FROM campana.registrar_simpatizante(
            'CC', v_r.documento_hash, v_r.documento_cifrado, v_r.nombres, v_r.apellidos,
            NULL, NULL, v_r.territorio_residencia_id, v_r.otro_link, 'FORMULARIO_WEB', 1::smallint,
            ARRAY['ORGANIZACION_CAMPANA'], 'demo');
    END LOOP;

    -- Clasificación de necesidades (como si lo hubiera hecho la IA)
    INSERT INTO participacion.clasificaciones_ia (necesidad_id, categoria_codigo, modelo, confianza)
    SELECT n.id, v_categorias[array_position(v_necesidades, n.descripcion)], 'demo-clasificador', 0.9
      FROM participacion.necesidades n;

    -- Programa de gobierno
    INSERT INTO participacion.ejes_programa (codigo, nombre, orden) VALUES
        ('INFRA', 'Infraestructura y conectividad', 1),
        ('SOCIAL', 'Desarrollo social', 2),
        ('RURAL', 'Desarrollo rural', 3);
    INSERT INTO participacion.propuestas (eje_codigo, titulo, contenido, publicada) VALUES
        ('INFRA',  'Vías terciarias para el Caquetá', 'Texto de ejemplo', true),
        ('SOCIAL', 'Salud cerca de la vereda',        'Texto de ejemplo', true),
        ('RURAL',  'Apoyo al pequeño productor',       'Texto de ejemplo', true);
    INSERT INTO participacion.propuesta_categorias
    SELECT id, CASE eje_codigo WHEN 'INFRA' THEN 'VIAS' WHEN 'SOCIAL' THEN 'SALUD' ELSE 'AGRO' END
      FROM participacion.propuestas;

    -- Un evento en Florencia con asistentes
    INSERT INTO eventos.eventos (tipo_codigo, nombre, territorio_id, inicia_en, termina_en, codigo_checkin, creado_por)
    SELECT 'FORO', 'Foro de propuestas Florencia', t.id, now() - interval '10 days',
           now() - interval '10 days' + interval '3 hours', util.generar_codigo(10),
           (SELECT id FROM acceso.usuarios WHERE login = 'gerente@demo.co')
      FROM territorio.territorios t WHERE t.codigo_oficial = '18001';
    INSERT INTO eventos.asistencias (evento_id, persona_id, metodo)
    SELECT e.id, s.persona_id, 'MANUAL'
      FROM eventos.eventos e
     CROSS JOIN LATERAL (SELECT persona_id FROM campana.v_simpatizantes WHERE municipio = 'FLORENCIA'
                          ORDER BY random() LIMIT 60) s;
END $$;

UPDATE campana.parametros SET valor = '20' WHERE clave = 'REGISTRO_MASIVO_UMBRAL';

COMMIT;

SELECT campana.refrescar_conteos();

SELECT * FROM campana.v_tablero;
