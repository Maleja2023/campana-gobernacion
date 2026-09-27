import { useEffect, useState } from 'react';
import { api, type CatalogoMunicipio, type LiderRegistro, type PoliticaRegistro } from '../api/cliente';
import { guardar, leer } from './almacen';

export type CatalogoRegistro = {
  municipios: CatalogoMunicipio[];
  lideres: LiderRegistro[];
  politica: PoliticaRegistro;
  actualizado: string;
};

export type EstadoCatalogo = {
  catalogo: CatalogoRegistro | null;
  cargando: boolean;
  /** true si se está usando la copia guardada porque no hay conexión. */
  sinConexion: boolean;
  error: string | null;
};

/**
 * Datos para el formulario de registro: se piden a la API y se guardan en el
 * celular cada vez que hay conexión; sin conexión se usa la última copia.
 * Así, abrir "Registrar" una vez con señal deja el celular listo para la vereda.
 */
export function useCatalogoRegistro(usuarioId: string | undefined): EstadoCatalogo {
  const [estado, setEstado] = useState<EstadoCatalogo>({ catalogo: null, cargando: true, sinConexion: false, error: null });

  useEffect(() => {
    if (!usuarioId) return;
    let vigente = true;
    const clave = `registro:${usuarioId}`;
    (async () => {
      try {
        const [municipios, lideres, politica] = await Promise.all([api.catalogoRegistro(), api.lideresRegistro(), api.politicaRegistro()]);
        const catalogo: CatalogoRegistro = { municipios, lideres, politica, actualizado: new Date().toISOString() };
        await guardar('catalogos', catalogo, clave).catch(() => undefined);
        if (vigente) setEstado({ catalogo, cargando: false, sinConexion: false, error: null });
      } catch (causa) {
        const guardado = await leer<CatalogoRegistro>('catalogos', clave).catch(() => undefined);
        if (!vigente) return;
        if (guardado) setEstado({ catalogo: guardado, cargando: false, sinConexion: true, error: null });
        else setEstado({ catalogo: null, cargando: false, sinConexion: false, error: causa instanceof Error ? causa.message : 'No fue posible cargar los datos del formulario.' });
      }
    })();
    return () => {
      vigente = false;
    };
  }, [usuarioId]);

  return estado;
}

/** Quita tildes y pasa a minúsculas para buscar "macagual" dentro de "MACAGUAL". */
export function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
