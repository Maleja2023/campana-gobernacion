import QRCode from 'qrcode';

const FUENTE = '"Public Sans Variable", system-ui, sans-serif';

/** Escribe centrado, achicando la letra si el texto no cabe en el ancho. */
function textoAjustado(c: CanvasRenderingContext2D, texto: string, y: number, peso: number, tamano: number, ancho = 640) {
  let t = tamano;
  do {
    c.font = `${peso} ${t}px ${FUENTE}`;
    t -= 1;
  } while (c.measureText(texto).width > ancho && t > 14);
  c.fillText(texto, 360, y);
}

/** Tarjeta PNG (720x1000) con el QR, lista para imprimir o compartir. */
export async function tarjetaConQr(destacado: string, codigo: string, url: string, lema = 'Escanea y regístrate'): Promise<string> {
  const qr = await QRCode.toDataURL(url, { margin: 1, width: 520, errorCorrectionLevel: 'M' });
  const imagen = new Image();
  imagen.src = qr;
  await imagen.decode();
  const lienzo = document.createElement('canvas');
  lienzo.width = 720;
  lienzo.height = 1000;
  const c = lienzo.getContext('2d')!;
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, 720, 1000);
  c.fillStyle = '#0b1b2e';
  c.fillRect(0, 0, 720, 200);
  c.fillStyle = '#ffffff';
  c.textAlign = 'center';
  textoAjustado(c, 'Campaña a la Gobernación del Caquetá', 90, 600, 30);
  c.fillStyle = '#b7c5d8';
  textoAjustado(c, lema, 140, 400, 24);
  c.drawImage(imagen, 100, 250, 520, 520);
  c.fillStyle = '#0f1b2d';
  textoAjustado(c, destacado, 840, 600, 30);
  c.fillStyle = '#475467';
  textoAjustado(c, `Código ${codigo}`, 885, 400, 24);
  textoAjustado(c, url.replace(/^https?:\/\//, ''), 930, 400, 20);
  return lienzo.toDataURL('image/png');
}

export function descargar(dataUrl: string, archivo: string) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = archivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
