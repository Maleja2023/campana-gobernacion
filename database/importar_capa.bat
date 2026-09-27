@echo off
REM ============================================================================
REM  importar_capa.bat  (paso manual, ver docs\mapas-datos.md)
REM  Copia una capa de barrios o de comunas (shapefile .shp, .geojson o .gpkg)
REM  al esquema "staging" de PostgreSQL, con las columnas "nombre" y "geom".
REM
REM  COMO EJECUTARLO (en "OSGeo4W Shell", que viene con QGIS):
REM    cd "C:\Users\HP\Documents\campana-gobernacion\database"
REM    importar_capa.bat "C:\ruta\barrios_florencia.shp" NOMBRE barrios
REM    importar_capa.bat "C:\ruta\comunas_florencia.shp" COMUNA comunas
REM
REM  - 1er dato: el archivo.
REM  - 2do dato: la columna del archivo que tiene el nombre (abra la tabla de
REM    atributos en QGIS para verla: NOMBRE, NOM_BARRIO, BARRIO...).
REM  - 3er dato: "barrios" o "comunas".
REM  Si tiene varios municipios, importe cada archivo y ejecute
REM  cargar_barrios_comunas.sql después de cada uno.
REM ============================================================================

chcp 65001 >nul

if "%~3"=="" (
    echo Uso: importar_capa.bat archivo campo_nombre barrios^|comunas
    exit /b 1
)
if not exist "%~1" (
    echo No encuentro el archivo %~1
    exit /b 1
)

set PGHOST=localhost
set PGPORT=5432
set PGDATABASE=campana_gobernacion
set PGUSER=postgres
set /p PGPASSWORD=Contrasena del usuario postgres: 

ogr2ogr -f PostgreSQL PG:"host=%PGHOST% port=%PGPORT% dbname=%PGDATABASE% user=%PGUSER%" "%~1" ^
  -dialect SQLite -sql "SELECT \"%~2\" AS nombre, geometry FROM \"%~n1\"" ^
  -nln %~3 -nlt MULTIPOLYGON -overwrite -lco SCHEMA=staging -lco GEOMETRY_NAME=geom -t_srs EPSG:4326 || goto error

echo Listo: staging.%~3. Ahora, en psql: \i database/cargar_barrios_comunas.sql
exit /b 0

:error
echo Hubo un error importando la capa. Revise el nombre de la columna (2do dato).
exit /b 1
