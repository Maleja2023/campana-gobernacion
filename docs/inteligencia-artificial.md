# Inteligencia artificial en la plataforma

La plataforma usa **Claude** (de Anthropic) para dos cosas en **Voz del territorio**:

1. **Clasificar las necesidades** que reporta la gente (en el registro, en las
   visitas y en "Reportar necesidad") en: vías, agua y saneamiento, salud,
   educación, empleo, seguridad, vivienda, agro, conectividad, ambiente u otra.
   La clasificación corre sola cada 10 minutos. También hay un botón
   "Clasificar ahora".
2. **Escribir el informe de necesidades de cada municipio**: resumen,
   principales necesidades por tema y zona, zonas prioritarias, propuestas
   para el programa de gobierno y vacíos de información. Es un **borrador**:
   un miembro del equipo debe revisarlo antes de usarlo.

Sin la IA configurada, la plataforma sigue funcionando: las necesidades se
clasifican por **palabras clave**, con menos precisión, y el botón de informe
aparece desactivado. Cuando la IA se activa, reemplaza esas clasificaciones.
Si la IA falla (por ejemplo, sin internet o sin saldo), las necesidades
pendientes se clasifican por palabras clave mientras tanto, y la IA vuelve a
intentarlo en la siguiente corrida.

La categoría se puede **corregir a mano** en "Necesidades reportadas". La
corrección manual siempre manda sobre la IA.

---

## Paso a paso para activarla

1. Cree una cuenta en **console.anthropic.com** con el correo de la campaña.
2. En **Billing**, agregue un medio de pago y compre créditos. Con USD 20
   alcanza para empezar (vea los costos abajo). Puede fijar un límite de
   gasto mensual en **Limits**.
3. En **API Keys → Create Key**, cree una clave llamada "plataforma-campana".
   Cópiela: empieza por `sk-ant-` y solo se muestra una vez.
4. En el servidor, abra el archivo `.env` de la API (`backend/.env`) y agregue:
   ```
   ANTHROPIC_API_KEY=sk-ant-...la clave...
   IA_MODELO=claude-opus-5
   ```
5. Reinicie la API (`sudo systemctl restart campana-api` en producción, o
   detenga y vuelva a iniciar `npm run start` en su computador).
6. Entre a **Voz del territorio**. Debe decir "Clasificación con
   inteligencia artificial activa". Pulse **Clasificar ahora** para no
   esperar los 10 minutos.

**Nunca** suba la clave a Git ni la comparta por WhatsApp o correo. Si se
filtra, bórrela en la consola de Anthropic y cree otra.

Si la clave está mal escrita o no tiene saldo, la pantalla lo dice
("La clave de la IA no es válida…", "revise el saldo…").

## Costos aproximados

Se cobra por uso, en dólares, con los precios publicados por Anthropic para
el modelo configurado (por defecto `claude-opus-5`). Los valores son
estimados y pueden variar:

| Uso | Costo aproximado |
|---|---|
| Clasificar 1.000 necesidades | USD 1 a 3 |
| Un informe de un municipio (100 a 400 necesidades) | USD 0,20 a 0,60 |

El consumo real se ve en console.anthropic.com → **Usage**.

## Protección de datos (Ley 1581 de 2012)

- A la IA **solo** se envía el texto de la necesidad y el nombre del
  municipio, la vereda o el barrio. **Nunca** nombres, cédulas, teléfonos ni
  la persona que la reportó.
- Antes de enviar el texto, la API **borra los números largos** (cédulas,
  teléfonos) y los **correos** que la persona haya escrito en él.
- Los informes no muestran quién reportó cada necesidad, y la IA tiene la
  instrucción de no incluir nombres de personas.
- Los datos viajan a los servidores de Anthropic, fuera de Colombia, así que
  hay una transferencia internacional de datos. Antes de activar la IA:
  - incluya en la **política de tratamiento de datos** que las necesidades
    reportadas se procesan con un proveedor tecnológico de inteligencia
    artificial para clasificarlas y analizarlas;
  - revise los términos comerciales de Anthropic
    (anthropic.com/legal/commercial-terms) con quien asesore a la campaña en
    protección de datos, entre otras cosas qué uso hace el proveedor de los
    datos enviados por la API.
