# Módulos estratégicos: quién accede y dónde va cada uno

Análisis de los cinco módulos propuestos frente a los roles y permisos que la
plataforma ya tiene. Este documento dice quién puede ver o manejar cada cosa,
en qué parte del menú va, qué datos usa y qué riesgo tiene. No describe cómo
se construye.

## Roles actuales (resumen)

| Rol | Alcance | Qué maneja hoy |
|---|---|---|
| Superadministrador | Todo | Configuración técnica |
| Candidato | Departamento, solo lectura | Tablero, mapa, agenda, conteo del Día D; aprueba mensajes |
| Gerente | Departamento | Todo lo operativo: usuarios, metas, alertas, comunicaciones, Día D, protección de datos |
| Coordinador | Su municipio y su red | Agenda, eventos, su red de líderes, testigos de su municipio |
| Líder / Sublíder | Su red | Registrar simpatizantes, su enlace, reportar necesidades |
| Digitador | Registro asistido | Solo registrar |
| Testigo | Sus mesas | Solo cargar el E-14 |

Principio que se mantiene: **cada rol ve solo su territorio o su red**, lo
aplica la base de datos (RLS) y no solo la pantalla.

---

## 1. Análisis electoral histórico

**Dónde va:** *Seguimiento → Análisis electoral* (pantalla nueva), más una capa
**"Histórico"** en el *Mapa territorial*, junto a la de brecha electoral.

**Quién accede**

| Rol | Acceso |
|---|---|
| Candidato | Ve todo el departamento |
| Gerente | Ve todo y carga los archivos de resultados |
| Coordinador | Ve su municipio (para priorizar veredas y puestos) |
| Líder | Solo la lista de prioridades de su zona, sin el detalle de otros municipios. **Opcional**: se puede dejar fuera. |
| Digitador, testigo | No |

Permisos nuevos: `ANALISIS_VER` (candidato, gerente, coordinador) y
`ANALISIS_CARGAR` (gerente).

**Qué muestra**
- Resultados por puesto y por mesa de elecciones anteriores (Gobernación
  2019 y 2023, Asamblea, y los del partido).
- Abstención por puesto: potencial menos votantes.
- Fuerza histórica del partido por puesto.
- El cruce con nuestros datos: puestos donde el partido fue fuerte y la red de
  referidos es débil frente al potencial.
- Una lista **"dónde invertir"**, ordenada por oportunidad.

**Datos:** son públicos (Registraduría). Se cargan con un script como el del
potencial electoral, a una tabla de resultados históricos por puesto, mesa,
corporación y partido. No tienen datos personales.

**Riesgo:** bajo. **Valor:** muy alto. La mayor parte de la base ya existe:
puestos, potencial y la capa de brecha.

---

## 2. Asistente con IA para el candidato

**Dónde va:**
- **Resumen semanal**: tarjeta al inicio del *Tablero* para el candidato y el
  gerente. Llega también como notificación (la campana) el lunes a las 6 a. m.
- **Nota antes de la visita**: botón *"Preparar visita"* en el detalle de cada
  visita de la *Agenda*. Resume qué pidió esa vereda antes, qué compromisos
  hay abiertos, cuántos simpatizantes hay y quién es el líder de la zona.

**Quién accede**

| Rol | Acceso |
|---|---|
| Candidato | Resumen de todo el departamento y notas de visita |
| Gerente | Lo mismo, y puede pedir un resumen en cualquier momento |
| Coordinador | Resumen de **su municipio** y notas de las visitas que organiza |
| Líder, digitador, testigo | No |

Permiso nuevo: `ASISTENTE_IA`.

**Reglas**
- Solo trabaja con cifras que calcula el sistema: crecimiento, veredas sin
  visita, compromisos vencidos, necesidades por categoría.
- **No se envían nombres, cédulas ni teléfonos a la IA.** La política ya
  tiene la finalidad "análisis agregado".
- Cada frase lleva el dato de donde sale, y la IA tiene prohibido inventar.
  Es el mismo esquema de "Voz del territorio", que ya usa Claude.
- Cada resumen queda guardado, para comparar semana a semana y auditar.

**Riesgo:** bajo, si se respeta lo anterior. **Valor:** alto para el
candidato, que no tiene tiempo de revisar tableros.

---

## 3. Planeación de recorridos

**Dónde va:** *Territorio → Agenda territorial → pestaña "Planear recorrido"*.

**Quién accede**

| Rol | Acceso |
|---|---|
| Gerente | Planea en todo el departamento |
| Coordinador | Planea en su municipio |
| Candidato | Ve los recorridos propuestos y aprobados |
| Líder | Ve cuándo pasa el recorrido por su zona (opcional) |

No necesita permisos nuevos: usa `AGENDA_GESTIONAR` para planear y
`AGENDA_VER` para ver.

**Cómo funciona**
1. Se eligen el municipio y los días disponibles.
2. El sistema propone veredas prioritarias: muchas personas simpatizantes,
   ninguna visita reciente, necesidades sin atender. Ya tenemos esos datos.
3. Agrupa las veredas cercanas, porque la base de datos geográfica ya tiene
   su ubicación, y propone un orden.
4. El coordinador ajusta la propuesta y la convierte en visitas programadas.

**Límite honesto:** en el Caquetá las distancias reales dependen de ríos,
trochas y temporada de lluvias. Un mapa de carreteras no las conoce. La
primera versión agrupa por cercanía y deja que el coordinador marque
**tramos fluviales o de trocha con tiempos manuales**. Con el uso, esos
tiempos quedan guardados y las propuestas mejoran.

**Riesgo:** bajo. **Valor:** medio-alto, sobre todo en municipios grandes como
San Vicente, Cartagena del Chairá y Solano.

---

## 4. Gestión de voluntarios y tareas

**Dónde va:**
- *Organización → Tareas*, para quien asigna.
- *Mis tareas*, para quien las cumple. Aparece también en la campana.

**Quién accede**

| Rol | Puede |
|---|---|
| Gerente | Asignar tareas a cualquier coordinador o líder, y ver el cumplimiento de todos |
| Coordinador | Asignar tareas a los líderes de **su** red y ver su cumplimiento |
| Líder | Ver y cumplir sus tareas, con evidencia (foto o nota); asignar a sus sublíderes |
| Sublíder | Ver y cumplir sus tareas |
| Candidato | Ver el tablero de cumplimiento (solo lectura) |

Las tareas **bajan por la jerarquía** de la red: nadie asigna a alguien que
no está debajo de él. Es la misma regla de "Mi red".

Permisos nuevos: `TAREA_ASIGNAR` (gerente, coordinador, líder) y `TAREA_VER`
(todos los de la red).

**Voluntarios:** en el registro público, quien quiera marca "Quiero ayudar
como voluntario" y dice en qué: transporte, redes, logística o eventos.
- Quedan en una lista por municipio que ve el coordinador.
- El coordinador los convierte en sublíderes o les asigna tareas puntuales.
- Esto amplía la finalidad del dato; se agrega a la política.

**Riesgo:** bajo. **Valor:** alto. Usa lo que ya existe: la red, la campana de
notificaciones y los enlaces.

---

## 5. Finanzas de campaña (reporte al CNE)

**Dónde va:** sección nueva **Finanzas**, separada del resto. Conviene
publicarla solo en el dominio administrativo (`admin.dominio.co`, protegido
con Cloudflare Access; ver `docs/cloudflare.md`).

**Quién accede.** Aquí aparecen **roles nuevos**, porque la ley exige un
gerente de campaña responsable de los recursos y la firma de un contador
público:

| Rol | Puede |
|---|---|
| **Tesorero / contador** (rol nuevo) | Registrar aportes, créditos y gastos, cargar soportes (facturas) y preparar el informe |
| Gerente | Aprobar cada gasto y ver todo |
| Candidato | Ver el resumen: ingresos, gastos y cuánto falta para el tope |
| **Auditor** (rol nuevo, del partido) | Solo lectura de todo, incluida la bitácora |
| Coordinador | Solo **solicitar** un gasto de su municipio con su soporte, que el gerente aprueba. No ve las finanzas generales. |
| Líder, digitador, testigo | No |

Permisos nuevos: `FINANZAS_REGISTRAR`, `FINANZAS_APROBAR`, `FINANZAS_VER` y
`GASTO_SOLICITAR`.

**Qué hace**
- Registro de **aportes**, con la identificación del aportante y su
  autorización de datos. La plataforma avisa si un aporte supera los
  límites de la ley o viene de una fuente prohibida (anónima o extranjera,
  entre otras).
- Registro de créditos y recursos propios.
- **Gastos** clasificados en las categorías del reporte oficial, cada uno con
  su factura o soporte, que se fotografía y guarda con su huella, como el
  E-14.
- Semáforo contra el **tope de gastos** que fije el CNE para la elección.
- Exportación de los anexos para cargarlos en el aplicativo **Cuentas Claras**
  del CNE. El informe oficial se sigue presentando allí; la plataforma no lo
  reemplaza.
- Todo inmutable y en la bitácora: un gasto no se borra, se anula con motivo.

**Riesgo:** **alto** (legal). Antes de construirlo se necesita:
1. que el **contador de la campaña** entregue las categorías y los formatos
   exactos vigentes para 2027;
2. que confirme los límites de aportes y el tope de gastos;
3. una política de datos para aportantes, que también son titulares de datos.

**Valor:** alto. Evita sanciones y el caos de hojas de cálculo al rendir
cuentas.

---

## Orden recomendado

| # | Módulo | Por qué en este orden |
|---|---|---|
| 1 | Tareas y voluntarios | Rápido, lo usa toda la red desde ya, aprovecha lo existente |
| 2 | Análisis electoral histórico | El más valioso para decidir dónde invertir; datos públicos |
| 3 | Asistente IA | Se alimenta de lo anterior (histórico, agenda, necesidades) |
| 4 | Planeación de recorridos | Necesita buena agenda y prioridades, que 1 a 3 mejoran |
| 5 | Finanzas | Empieza cuando el contador entregue formatos y reglas vigentes |

## Menú resultante

```
Seguimiento:   Tablero (con resumen IA) · Reportes · Análisis electoral (nuevo) · Mapa (capa histórico) · Simpatizantes · Alertas
Territorio:    Agenda (con "Planear recorrido" y "Preparar visita") · Voz del territorio · Reportar necesidad · Día de elecciones
Organización:  Mi red · Tareas (nuevo) · Registrar simpatizante · Comunicaciones · Usuarios · Protección de datos
Finanzas:      Aportes · Gastos · Informe CNE (nuevo, solo en el dominio administrativo)
```
