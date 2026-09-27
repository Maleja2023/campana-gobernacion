# Día D: testigos, E-14 y conteo rápido

## Quién hace qué

| Rol | Qué ve y hace en "Día de elecciones" |
|---|---|
| **Testigo electoral** | Solo sus mesas. Toma la foto del E-14 y digita los votos. No ve nada más de la plataforma. |
| **Coordinador** | Asigna testigos a las mesas de **su municipio**, revisa los E-14 de su municipio y ve el conteo en vivo de su territorio. |
| **Gerente** | Todo lo anterior en el departamento, y además la configuración: jornada, tarjetón (candidatos) y número de mesas. |
| **Candidato** | Conteo en vivo (solo lectura). |

## Antes de la elección (semanas antes)

1. **Jornada**: en *Día de elecciones → Configuración*, cree la jornada
   (por ejemplo "Territoriales 2027", fecha de la elección).
   - Copia los puestos de la jornada anterior y queda activa.
   - Si la Registraduría crea o cierra puestos, ajústelos con el archivo
     Divipole nuevo (paso 3).
2. **Tarjetón**: agregue los candidatos a la Gobernación con su partido y
   marque cuál es el nuestro. Voto en blanco, votos nulos y tarjetas no
   marcadas se crean solos.
3. **Mesas**: el Divipole de la Registraduría trae cuántas mesas tiene cada
   puesto.
   - Agregue la columna `mesas` al CSV del potencial electoral
     (`docs/mapas-datos.md`, sección 1) y cárguelo:
     ```
     \i database/cargar_potencial_puestos.sql
     \copy staging.potencial_puestos(municipio, puesto, potencial, mesas) FROM 'C:/datos/divipole.csv' WITH (FORMAT csv, HEADER true, DELIMITER ';', ENCODING 'UTF8')
     SELECT * FROM staging.aplicar_potencial_puestos();
     ```
   - También se pueden escribir a mano, puesto por puesto, en Configuración.
4. **Testigos**:
   - la gerencia crea las cuentas en *Usuarios* con el rol **Testigo
     electoral** y el municipio;
   - cada coordinador los asigna en *Testigos y mesas*;
   - un testigo puede cubrir varias mesas, siempre del mismo puesto.
5. **Capacitación y simulacro**:
   - cada testigo entra, cambia su clave y activa el doble factor;
   - un día antes, cada uno carga una foto de prueba;
   - después, la coordinación borra esas pruebas: reabre el E-14 y lo carga
     de nuevo con ceros, o pide al administrador que limpie la tabla.

## El día de la elección

- Al cierre, el testigo abre *Mis mesas*, toma la foto del E-14 (la app la
  achica para que suba con poca señal), digita los votos y guarda.
- Si la suma pasa de `MESA_MAX_VOTANTES` (400 por defecto), el E-14 queda
  **con inconsistencias** para revisión.
- Los coordinadores revisan en *Revisión de E-14*: comparan la foto con los
  números y validan o marcan inconsistente. Un E-14 validado ya no lo puede
  cambiar el testigo; para corregirlo, se reabre.
- El *Conteo en vivo* se actualiza solo cada 20 segundos.
  - Muestra el avance de mesas, los votos por candidato (con y sin
    validar) y el resultado por municipio.
  - Es un conteo **propio**, no el resultado oficial.

## Servidor

- Las fotos se guardan en `E14_DIRECTORIO` (por defecto `almacen/e14` junto a
  la API), con su huella sha256 como nombre.
  - Al mostrarlas se verifica que no hayan cambiado.
  - Solo las ve el testigo de la mesa o quien gestiona el Día D en ese
    territorio.
- Agregue `E14_DIRECTORIO` a `/etc/campana/respaldo.env` para que el respaldo
  diario incluya las fotos, cifradas.
- Nginx: el límite general es de 1 MB. Para la carga de fotos agregue,
  antes de `location /api/`:
  ```nginx
  location = /api/dia-d/e14 {
      client_max_body_size 9m;
      proxy_pass http://127.0.0.1:3000;
      proxy_set_header Host $host;
      proxy_set_header X-Forwarded-For $remote_addr;
      proxy_set_header X-Forwarded-Proto https;
  }
  ```
- Ese día, active en Cloudflare la regla de límite de peticiones con un
  margen amplio para `/api/dia-d/`: cientos de testigos cargan casi al
  mismo tiempo.
