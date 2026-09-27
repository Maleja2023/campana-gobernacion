import { api } from '../api/cliente';
import { useDatos } from './useDatos';

export function useMunicipios() {
  return useDatos(() => api.get<{ id: number; nombre: string }[]>('/territorio/municipios'), []);
}
