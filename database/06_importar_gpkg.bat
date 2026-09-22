@echo off
REM ============================================================================
REM  06_importar_gpkg.bat
REM  Copia las 4 capas de caqueta.gpkg al esquema "staging" de PostgreSQL.
REM
REM  COMO EJECUTARLO:
REM   1. Abre "OSGeo4W Shell" (viene con QGIS; buscalo en el menu Inicio).
REM   2. Ve a esta carpeta, por ejemplo:
REM        cd "C:\Users\HP\Documents\campana-gobernacion\database"
REM   3. Escribe:  06_importar_gpkg.bat
REM ============================================================================

chcp 65001 >nul

set GPKG=..\datos_gis\caqueta.gpkg
set PGHOST=localhost
set PGPORT=5432
set PGDATABASE=campana_gobernacion
set PGUSER=postgres

if not exist "%GPKG%" (
    echo No encuentro %GPKG%. Revisa que caqueta.gpkg este en la carpeta datos_gis.
    exit /b 1
)

set /p PGPASSWORD=Contrasena del usuario postgres: 

set PG=PG:"host=%PGHOST% port=%PGPORT% dbname=%PGDATABASE% user=%PGUSER%"
set OPC=-overwrite -lco SCHEMA=staging -lco GEOMETRY_NAME=geom -t_srs EPSG:4326

echo Importando departamento...
ogr2ogr -f PostgreSQL %PG% "%GPKG%" departamento -nln departamento -nlt MULTIPOLYGON %OPC% || goto error

echo Importando municipios...
ogr2ogr -f PostgreSQL %PG% "%GPKG%" municipios -nln municipios -nlt MULTIPOLYGON %OPC% || goto error

echo Importando veredas...
ogr2ogr -f PostgreSQL %PG% "%GPKG%" veredas -nln veredas -nlt MULTIPOLYGON %OPC% || goto error

echo Importando puestos de votacion...
ogr2ogr -f PostgreSQL %PG% "%GPKG%" puestos_votacion -nln puestos_votacion -nlt POINT %OPC% || goto error

echo.
echo Listo. Ahora ejecuta 07_carga_territorio.sql en la base %PGDATABASE%.
set PGPASSWORD=
exit /b 0

:error
echo.
echo Hubo un error importando. Revisa el mensaje de arriba.
set PGPASSWORD=
exit /b 1
