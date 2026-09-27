import ExcelJS from 'exceljs';

export interface ColumnaReporte {
  titulo: string;
  clave: string;
  ancho?: number;
  tipo?: 'texto' | 'numero' | 'porcentaje' | 'fecha';
}

/** Igual que en el exporte de simpatizantes: evita que un texto se lea como fórmula. */
function sanear(valor: unknown): unknown {
  return typeof valor === 'string' && /^[=+\-@\t\r]/.test(valor) ? `'${valor}` : valor;
}

export async function construirLibroReporte(titulo: string, columnas: ColumnaReporte[], filas: Record<string, unknown>[]): Promise<Buffer> {
  const libro = new ExcelJS.Workbook();
  libro.creator = 'Plataforma de campaña';
  libro.created = new Date();
  const hoja = libro.addWorksheet(titulo.slice(0, 31));
  hoja.columns = columnas.map((c) => ({ header: c.titulo, key: c.clave, width: c.ancho ?? 16 }));
  hoja.getRow(1).font = { bold: true };
  hoja.views = [{ state: 'frozen', ySplit: 1 }];

  for (const fila of filas) {
    const salida: Record<string, unknown> = {};
    for (const c of columnas) {
      const v = fila[c.clave];
      if (v === null || v === undefined) salida[c.clave] = null;
      else if (c.tipo === 'numero') salida[c.clave] = Number(v);
      else if (c.tipo === 'porcentaje') salida[c.clave] = Number(v) / 100;
      else if (c.tipo === 'fecha') salida[c.clave] = new Date(v as string);
      else salida[c.clave] = sanear(String(v));
    }
    hoja.addRow(salida);
  }
  for (const c of columnas) {
    if (c.tipo === 'porcentaje') hoja.getColumn(c.clave).numFmt = '0.0%';
    if (c.tipo === 'fecha') hoja.getColumn(c.clave).numFmt = 'yyyy-mm-dd';
    if (c.tipo === 'numero') hoja.getColumn(c.clave).numFmt = '#,##0';
  }
  return Buffer.from(await libro.xlsx.writeBuffer());
}
