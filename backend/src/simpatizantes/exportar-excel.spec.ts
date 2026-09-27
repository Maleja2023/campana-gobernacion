import ExcelJS from 'exceljs';
import { construirLibroSimpatizantes, type FilaExportable } from './exportar-excel.js';

const fila = (extra: Partial<FilaExportable> = {}): FilaExportable => ({
  nombres: 'Ana',
  apellidos: 'Pérez',
  territorio_residencia: 'Comuna 1',
  municipio: 'Cali',
  referido_por: 'Luis Gómez',
  canal_codigo: 'WEB',
  estado_codigo: 'ACTIVO',
  capturado_en: '2026-03-04T15:30:00.000Z',
  ...extra,
});

// Al releer el archivo se pierden las `key` de las columnas, así que se
// direccionan por posición, en el mismo orden en que las declara la hoja.
const COLUMNA = { nombres: 1, apellidos: 2, municipio: 4, referido_por: 5, capturado_en: 8 };

/** Vuelve a leer el buffer generado y devuelve la hoja, tal como la abriría Excel. */
async function releer(filas: FilaExportable[]) {
  const buffer = await construirLibroSimpatizantes(filas);
  const libro = new ExcelJS.Workbook();
  // exceljs declara su propio tipo Buffer, incompatible con el de @types/node.
  await libro.xlsx.load(buffer as unknown as Parameters<typeof libro.xlsx.load>[0]);
  const hoja = libro.getWorksheet('Simpatizantes');
  if (!hoja) throw new Error('El libro no tiene la hoja Simpatizantes');
  return hoja;
}

describe('construirLibroSimpatizantes', () => {
  it('escribe una fila de encabezados y una fila por simpatizante', async () => {
    const hoja = await releer([fila(), fila({ nombres: 'Beto' })]);

    expect(hoja.getRow(1).getCell(1).value).toBe('Nombres');
    expect(hoja.getRow(2).getCell(1).value).toBe('Ana');
    expect(hoja.getRow(3).getCell(1).value).toBe('Beto');
    expect(hoja.rowCount).toBe(3);
  });

  it('no altera los valores que no empiezan por un carácter de fórmula', async () => {
    const hoja = await releer([fila()]);

    expect(hoja.getRow(2).getCell(COLUMNA.nombres).value).toBe('Ana');
    expect(hoja.getRow(2).getCell(COLUMNA.apellidos).value).toBe('Pérez');
    expect(hoja.getRow(2).getCell(COLUMNA.referido_por).value).toBe('Luis Gómez');
  });

  // Estos tres campos vienen del autorregistro público (POST /registro), sin saneo.
  it.each(['=', '+', '-', '@'])(
    'antepone un apóstrofo a nombres, apellidos y referido_por que empiezan por "%s"',
    async (caracter) => {
      const valor = `${caracter}HYPERLINK("http://malo","clic")`;
      const hoja = await releer([fila({ nombres: valor, apellidos: valor, referido_por: valor })]);

      const filaLeida = hoja.getRow(2);
      expect(filaLeida.getCell(COLUMNA.nombres).value).toBe(`'${valor}`);
      expect(filaLeida.getCell(COLUMNA.apellidos).value).toBe(`'${valor}`);
      expect(filaLeida.getCell(COLUMNA.referido_por).value).toBe(`'${valor}`);
    },
  );

  it('no escribe ninguna celda como fórmula, aunque el texto lo parezca', async () => {
    const hoja = await releer([fila({ nombres: '=1+1' })]);
    const celda = hoja.getRow(2).getCell(COLUMNA.nombres);

    expect(celda.type).toBe(ExcelJS.ValueType.String);
    expect(celda.formula).toBeUndefined();
  });

  it('tolera valores nulos sin romper el archivo', async () => {
    const hoja = await releer([
      fila({ nombres: null, apellidos: null, referido_por: null, municipio: null, capturado_en: null }),
    ]);

    expect(hoja.getRow(2).getCell(COLUMNA.nombres).value).toBeNull();
    expect(hoja.getRow(2).getCell(COLUMNA.capturado_en).value).toBeNull();
  });

  it('escribe la fecha de captura como fecha, no como texto', async () => {
    const hoja = await releer([fila()]);
    const celda = hoja.getRow(2).getCell(COLUMNA.capturado_en);

    expect(celda.value).toBeInstanceOf(Date);
    expect((celda.value as Date).toISOString()).toBe('2026-03-04T15:30:00.000Z');
  });
});
