# Mapa: datos que debe cargar a mano

El mapa ya trae el departamento, los 16 municipios, las 1.220 veredas y los 146
puestos de votación (fuentes: DANE y Registraduría 2023). Hay dos datos que no
son públicos en un formato que la plataforma pueda descargar sola, y que usted
debe conseguir y cargar:

| Qué falta | Para qué sirve | Quién lo entrega |
|---|---|---|
| Potencial electoral de cada puesto | Capa **Brecha electoral**: simpatizantes vs. votantes posibles por puesto | Registraduría (archivo Divipole) |
| Límites de comunas y barrios | Ver y registrar por barrio y comuna en las cabeceras | Oficina de Planeación de cada alcaldía (POT o EOT) |

Mientras no los cargue, el mapa funciona igual: la capa de brecha muestra un
aviso y las comunas aparecen en la lista como "sin límite en el mapa".

Para todo lo de abajo necesita **QGIS** (gratis, qgis.org). Trae el programa
"OSGeo4W Shell", el mismo que usó para importar el territorio. También necesita
**psql** conectado como `postgres`.

---

## 1. Potencial electoral por puesto (capa "Brecha electoral")

### 1.1 Conseguir el archivo

1. Entre a **registraduria.gov.co** y busque **"Divipole"** (División Político
   Electoral) de las elecciones que le interesan. Para las Territoriales de
   2027, la Registraduría lo publica unos meses antes de la elección. Mientras
   tanto, sirve el de 2023.
2. Descargue el archivo de Excel. Trae una fila por puesto, con
   departamento, municipio, zona, puesto, mesas y el potencial de votantes
   (hombres, mujeres y total).

### 1.2 Preparar el CSV

1. Abra el archivo en Excel y filtre el departamento **CAQUETÁ**.
2. Deje solo tres columnas, con estos encabezados exactos:
   `municipio`, `puesto`, `potencial`. En `potencial` va el **total** de
   votantes del puesto.
3. Guárdelo con *Archivo → Guardar como → CSV UTF-8 (delimitado por comas)*,
   por ejemplo como `C:\datos\potencial.csv`. Excel en español guarda el CSV
   separado por **punto y coma**, que es lo que espera el paso siguiente.

Ejemplo del contenido:

```
municipio;puesto;potencial
FLORENCIA;UNIVERSIDAD DE LA AMAZONIA;5200
ALBANIA;PUESTO CABECERA MUNICIPAL;3100
```

### 1.3 Cargarlo

En psql, conectado como `postgres`, desde la carpeta del proyecto:

```
\i database/cargar_potencial_puestos.sql
\copy staging.potencial_puestos(municipio, puesto, potencial) FROM 'C:/datos/potencial.csv' WITH (FORMAT csv, HEADER true, DELIMITER ';', ENCODING 'UTF8')
SELECT * FROM staging.aplicar_potencial_puestos();
```

- En la ruta del `\copy`, use `/` en lugar de `\`.
- El último comando dice cuántos puestos cargó y lista los que **no
  encontró**. Los nombres se comparan sin tildes ni mayúsculas y toleran
  pequeñas diferencias. Si alguno no aparece, corrija su nombre en el CSV
  para que se parezca al que muestra el mapa y repita los tres comandos.
- Si su archivo usa comas en lugar de punto y coma, cambie `DELIMITER ';'`
  por `DELIMITER ','`.

Después, en el mapa, elija la capa **Brecha electoral**. Cada puesto sale
coloreado según su cobertura, y la tabla lista primero los puestos donde más
votantes faltan.

---

## 2. Comunas y barrios

### 2.1 Conseguir las capas

Pida a la **Secretaría de Planeación** de cada alcaldía la cartografía de
**barrios** y **comunas** del POT (o del EOT/PBOT en los municipios
pequeños), en formato **shapefile (.shp)**, **GeoJSON** o **GeoPackage**. Un
shapefile son varios archivos con el mismo nombre (.shp, .shx, .dbf, .prj):
necesita todos, en la misma carpeta.

También puede buscar en **datos.gov.co** ("barrios Florencia", etc.).

### 2.2 Ver cómo se llama la columna del nombre

1. Abra el archivo en QGIS (arrástrelo a la ventana).
2. Clic derecho en la capa → **Abrir tabla de atributos**.
3. Anote el nombre de la columna que tiene el nombre del barrio o comuna,
   por ejemplo `NOMBRE`, `NOM_BARRIO` o `BARRIO`.

### 2.3 Importar y cargar

En **OSGeo4W Shell**:

```
cd "C:\Users\HP\Documents\campana-gobernacion\database"
importar_capa.bat "C:\datos\comunas_florencia.shp" NOMBRE comunas
importar_capa.bat "C:\datos\barrios_florencia.shp" NOM_BARRIO barrios
```

(El segundo dato es la columna del paso 2.2; el tercero, `comunas` o `barrios`.)

Luego, en psql como `postgres`:

```
\i database/cargar_barrios_comunas.sql
```

- Cargue primero las comunas y después los barrios: así cada barrio queda
  dentro de su comuna.
- El municipio de cada polígono se decide por **ubicación**, no por el
  nombre. Las comunas que ya existen (por ejemplo, las 4 de Florencia)
  reciben su límite sin duplicarse.
- Puede repetirlo cuantas veces quiera: actualiza sin duplicar.
- Para varios municipios, repita 2.3 con cada archivo.

Después, reinicie la API. En el mapa, al entrar a Florencia, aparecen las
comunas y, dentro de ellas, sus barrios. El formulario de registro también
permite elegir el barrio.

---

## 3. Opcional: ubicación GPS para el mapa de calor

Hoy el mapa de calor ubica cada registro en el centro de su vereda o
barrio. Si más adelante se decide guardar la ubicación GPS del registro, el
calor se vuelve más preciso sin cambiar nada más: la base de datos ya tiene
el campo. Como la ubicación es un dato personal, antes debe incluirse esa
finalidad en la política de tratamiento de datos.
