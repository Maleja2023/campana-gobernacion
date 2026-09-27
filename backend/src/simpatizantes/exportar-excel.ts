import ExcelJS from 'exceljs';

// Mismas columnas que ya expone GET /simpatizantes (campana.v_simpatizantes):
// nunca documento ni teléfono, que están cifrados y solo se descifran, uno a
// uno y auditado, a través de GET /simpatizantes/:personaId/documento.
export interface FilaExportable {
  nombres: string | null;
  apellidos: string | null;
  territorio_residencia: string | null;
  municipio: string | null;
  referido_por: string | null;
  canal_codigo: string | null;
  estado_codigo: string | null;
  capturado_en: string | Date | null;
}

/**
 * Defensa en profundidad contra inyección de fórmulas: nombres y apellidos
 * llegan del autorregistro público (POST /registro, sin permiso), así que un
 * desconocido puede sembrar un texto que empiece por = + - @. exceljs escribe
 * las cadenas como texto, no como fórmula, pero si alguien reexporta el
 * archivo a CSV y lo reabre, Excel sí lo evaluaría. El apóstrofo inicial lo
 * fuerza a texto en cualquier caso.
 */
function sanear(valor: string | null): string | null {
  return valor && /^[=+\-@\t\r]/.test(valor) ? `'${valor}` : valor;
}

export async function construirLibroSimpatizantes(filas: FilaExportable[]): Promise<Buffer> {
  const libro = new ExcelJS.Workbook();
  libro.creator = 'Plataforma de campaña';
  libro.created = new Date();

  const hoja = libro.addWorksheet('Simpatizantes');
  hoja.columns = [
    { header: 'Nombres', key: 'nombres', width: 22 },
    { header: 'Apellidos', key: 'apellidos', width: 22 },
    { header: 'Territorio de residencia', key: 'territorio_residencia', width: 28 },
    { header: 'Municipio', key: 'municipio', width: 20 },
    { header: 'Referido por', key: 'referido_por', width: 26 },
    { header: 'Canal', key: 'canal_codigo', width: 16 },
    { header: 'Estado', key: 'estado_codigo', width: 14 },
    { header: 'Registrado', key: 'capturado_en', width: 18 },
  ];
  hoja.getRow(1).font = { bold: true };

  for (const fila of filas) {
    hoja.addRow({
      ...fila,
      nombres: sanear(fila.nombres),
      apellidos: sanear(fila.apellidos),
      referido_por: sanear(fila.referido_por),
      capturado_en: fila.capturado_en ? new Date(fila.capturado_en) : null,
    });
  }
  hoja.getColumn('capturado_en').numFmt = 'yyyy-mm-dd hh:mm';

  const arrayBuffer = await libro.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
