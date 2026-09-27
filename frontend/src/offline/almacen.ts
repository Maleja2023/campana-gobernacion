/**
 * Almacenamiento local para trabajar sin conexión (IndexedDB).
 *
 * - `pendientes`: registros capturados sin señal, CIFRADOS con AES-GCM. La
 *   llave se genera en el navegador como no exportable: el código de la app
 *   puede usarla, pero nadie puede sacarla y leer los datos copiando los
 *   archivos del navegador.
 * - `catalogos`: municipios, veredas, puestos, líderes y política. No tienen
 *   datos personales de simpatizantes y se guardan sin cifrar.
 */

const NOMBRE_BD = 'campana-sin-conexion';
const VERSION_BD = 1;

export type Almacen = 'pendientes' | 'catalogos' | 'claves';

let conexion: Promise<IDBDatabase> | null = null;

function abrirBD(): Promise<IDBDatabase> {
  if (!conexion) {
    conexion = new Promise((resolver, rechazar) => {
      const pedido = indexedDB.open(NOMBRE_BD, VERSION_BD);
      pedido.onupgradeneeded = () => {
        const bd = pedido.result;
        if (!bd.objectStoreNames.contains('pendientes')) {
          const pendientes = bd.createObjectStore('pendientes', { keyPath: 'id' });
          pendientes.createIndex('usuario', 'usuarioId');
        }
        if (!bd.objectStoreNames.contains('catalogos')) bd.createObjectStore('catalogos');
        if (!bd.objectStoreNames.contains('claves')) bd.createObjectStore('claves');
      };
      pedido.onsuccess = () => resolver(pedido.result);
      pedido.onerror = () => {
        conexion = null;
        rechazar(pedido.error ?? new Error('No se pudo abrir el almacenamiento local'));
      };
    });
  }
  return conexion;
}

function comoPromesa<T>(pedido: IDBRequest<T>): Promise<T> {
  return new Promise((resolver, rechazar) => {
    pedido.onsuccess = () => resolver(pedido.result);
    pedido.onerror = () => rechazar(pedido.error);
  });
}

export async function leer<T>(almacen: Almacen, clave: IDBValidKey): Promise<T | undefined> {
  const bd = await abrirBD();
  return comoPromesa(bd.transaction(almacen).objectStore(almacen).get(clave)) as Promise<T | undefined>;
}

export async function guardar(almacen: Almacen, valor: unknown, clave?: IDBValidKey): Promise<void> {
  const bd = await abrirBD();
  await comoPromesa(bd.transaction(almacen, 'readwrite').objectStore(almacen).put(valor, clave));
}

export async function borrar(almacen: Almacen, clave: IDBValidKey): Promise<void> {
  const bd = await abrirBD();
  await comoPromesa(bd.transaction(almacen, 'readwrite').objectStore(almacen).delete(clave));
}

export async function leerPorUsuario<T>(usuarioId: string): Promise<T[]> {
  const bd = await abrirBD();
  const indice = bd.transaction('pendientes').objectStore('pendientes').index('usuario');
  return comoPromesa(indice.getAll(usuarioId)) as Promise<T[]>;
}

// ---------- Cifrado ----------

let llaveEnCurso: Promise<CryptoKey> | null = null;

/** Una sola llave por navegador. La promesa se comparte para que dos cifrados
 * simultáneos no generen dos llaves distintas (una dejaría datos ilegibles). */
function llave(): Promise<CryptoKey> {
  if (!llaveEnCurso) {
    llaveEnCurso = (async () => {
      const existente = await leer<CryptoKey>('claves', 'registros');
      if (existente) return existente;
      const nueva = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      await guardar('claves', nueva, 'registros');
      return nueva;
    })().catch((error: unknown) => {
      llaveEnCurso = null;
      throw error;
    });
  }
  return llaveEnCurso;
}

export type Cifrado = { iv: Uint8Array<ArrayBuffer>; datos: ArrayBuffer };

export async function cifrar(valor: unknown): Promise<Cifrado> {
  const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)));
  const datos = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await llave(), new TextEncoder().encode(JSON.stringify(valor)));
  return { iv, datos };
}

export async function descifrar<T>(c: Cifrado): Promise<T> {
  const plano = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: c.iv }, await llave(), c.datos);
  return JSON.parse(new TextDecoder().decode(plano)) as T;
}
