# Plan de cierre: qué pasa con la base de datos al terminar la campaña

La autorización que dieron los simpatizantes fue para **esta campaña**
(Ley 1581 de 2012, art. 4 y 11: principio de finalidad y deber de suprimir
cuando la finalidad termina). Cuando la campaña acaba, los datos personales
se **eliminan** o, si hay una razón legal documentada, se **entregan** al
responsable del tratamiento y luego se eliminan de la plataforma.

Nadie del equipo, ni el proveedor técnico, puede quedarse con una copia para
otra campaña, para un partido o para venderla.

---

## 1. Cuándo

| Momento | Qué se hace |
|---|---|
| Día de elecciones + 1 | Se cierran el registro público y los envíos de mensajes. Los líderes ya no pueden sumar personas (el administrador desactiva los enlaces). |
| Hasta 30 días después | Terminan escrutinios y reclamaciones. Se atienden las solicitudes de titulares pendientes. |
| **Día 30 a 60** | **Entrega (si aplica) y eliminación**, con acta. |
| Día 60 + 14 | Vencen los últimos respaldos y se destruyen las llaves. |

La fecha exacta la fija el responsable del tratamiento y se anota en el acta.

---

## 2. Decidir: ¿entrega o solo eliminación?

- **Solo eliminación** (lo recomendado): no queda ninguna copia de los datos
  personales. Se guardan solo cifras agregadas, que no identifican a nadie.
- **Entrega al responsable**: solo si existe una obligación legal de
  conservar algo (por ejemplo, un requerimiento de una autoridad o una
  investigación en curso). La entrega se hace **al responsable del
  tratamiento** (quien aparece en la política), nunca a terceros, y queda
  escrito:
  - qué se entrega;
  - para qué;
  - por cuánto tiempo;
  - cuándo se elimina.

  El responsable asume desde ese momento la custodia de esa copia.

Las autorizaciones **no** sirven para una campaña futura: si el candidato o
el partido quieren volver a contactar a estas personas, deben pedir una
autorización nueva.

---

## 3. Antes de eliminar

1. Descargar los **informes agregados** que se quieran conservar (tablero,
   reportes por municipio). No deben traer nombres, cédulas ni teléfonos.
2. Responder o cerrar todas las solicitudes de titulares abiertas
   (*Protección de datos → Solicitudes*).
3. Hacer un **último respaldo** con `scripts/respaldo.sh`. Es el que se
   entrega, si hay entrega. Si no hay entrega, se destruye con los demás.
4. Redactar el acta (plantilla en la sección 7) y reunir a:
   - el responsable del tratamiento;
   - quien administra el servidor;
   - un testigo.

---

## 4. Entrega (solo si se decidió en el paso 2)

1. Generar una llave `age` **nueva**, del responsable. La genera él, en su
   equipo, con `age-keygen`, y entrega solo la llave pública.
2. Cifrar el último respaldo para esa llave:
   ```bash
   age -d -i <llave-privada-de-la-campaña> campana-AAAA-MM-DD.dump.age \
     | age -r <llave-pública-del-responsable> > entrega-campana.dump.age
   sha256sum entrega-campana.dump.age
   ```
3. Entregar `entrega-campana.dump.age` en una memoria USB cifrada o por un
   medio que el responsable indique. Anotar el `sha256` en el acta.
4. Entregar también, **por separado** y en sobre sellado o por el gestor de
   contraseñas, `LLAVE_CIFRADO` y `PEPPER_HMAC`. Sin ellas las cédulas y
   los teléfonos del respaldo no se pueden leer.

---

## 5. Eliminación

En el servidor, en este orden:

1. **Detener la API**, para que nadie siga escribiendo:
   `sudo systemctl stop campana-api`
2. **Borrar los datos personales y dejar el acta en la base.** En psql como
   `postgres`:
   ```
   psql -d campana_gobernacion -v confirmar=ELIMINAR-DATOS-PERSONALES -f database/cierre_campana.sql
   ```
   - Guarda en el esquema `cierre` las cifras por municipio, por puesto (solo
     donde hay 10 o más simpatizantes), por necesidades y los resultados E-14.
   - Luego borra en una sola transacción:
     - personas, teléfonos, correos, simpatizantes, red y enlaces;
     - autorizaciones, solicitudes, eventos y asistencias, necesidades;
     - comunicaciones, usuarios y sesiones, formularios E-14;
     - la bitácora.
   - Imprime cuántos registros eliminó: cópielos al acta.
3. Si no se necesita conservar ni las cifras agregadas, borre la base
   completa: `dropdb campana_gobernacion`.
4. **Destruir las llaves** (cripto-borrado). Borre `LLAVE_CIFRADO`,
   `PEPPER_HMAC` y los secretos de sesión de:
   - el `.env` del servidor;
   - el gestor de contraseñas;
   - cualquier copia del `.env`.

   Desde ese momento, cualquier copia de la base que haya quedado en algún
   lado tiene las cédulas y los teléfonos ilegibles.
5. **Destruir los respaldos**:
   - local: `rm -rf /var/backups/campana`;
   - remoto: borre la carpeta `respaldos-campana` del proveedor (`rclone
     purge remoto:respaldos-campana`) y confirme en su panel que no quedó
     versión ni papelera;
   - por último, borre del gestor de contraseñas la llave privada `age` de
     los respaldos. Sin ella, los respaldos que el proveedor tarde en borrar
     son ilegibles.
6. **Otras copias**:
   - archivos de fotos de E-14, que no son datos personales pero se
     eliminan con el servidor;
   - exportes descargados por el equipo: se pide por escrito a cada persona
     que exportó que los borre (la bitácora, antes de borrarla, dice quién
     exportó qué: descárguela en el paso 3 de la sección 3);
   - bases de prueba o de desarrollo con datos reales, que no deberían
     existir, pero verifíquelo.
7. **Cancelar servicios**:
   - el servidor (pida al proveedor el borrado seguro del disco);
   - Cloudflare Access;
   - las cuentas de SMS o correo, cuyas listas de contactos se borran en el
     panel de cada proveedor.
8. Si la base se registró ante la SIC (Registro Nacional de Bases de Datos),
   actualizar el registro indicando la supresión.

---

## 6. Verificación

- `SELECT count(*) FROM personas.personas;` debe dar 0, o la base ya no
  existe.
- `rclone lsf remoto:respaldos-campana` no debe listar nada.
- En el gestor de contraseñas no quedan `LLAVE_CIFRADO`, `PEPPER_HMAC` ni la
  llave `age`, salvo en la entrega al responsable.

---

## 7. Plantilla del acta

```
ACTA DE CIERRE DE LA BASE DE DATOS DE LA CAMPAÑA
Campaña: ______________________   Responsable del tratamiento: ______________________
Fecha y hora: ________________   Lugar: ________________

1. Decisión: [ ] Solo eliminación   [ ] Entrega al responsable y eliminación
   Motivo de la entrega (si aplica): _____________________________________
   Plazo de conservación de la copia entregada: ___________________________
   sha256 de la copia entregada: _________________________________________

2. Registros eliminados (salida de cierre_campana.sql):
   personas: ____  simpatizantes: ____  usuarios: ____  bitácora: ____  otros: ____

3. Llaves destruidas: [ ] LLAVE_CIFRADO  [ ] PEPPER_HMAC  [ ] llave age de respaldos
4. Respaldos destruidos: [ ] locales  [ ] remotos (confirmado en el panel del proveedor)
5. Servidor: [ ] cancelado   [ ] se conserva sin datos personales
6. Exportes: [ ] se pidió por escrito su borrado a: _________________________

Firmas:
Responsable del tratamiento ________________   Administrador técnico ________________
Testigo ________________
```
