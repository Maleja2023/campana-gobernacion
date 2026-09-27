import { Injectable } from '@nestjs/common';
import { NoEncontradoError } from '../comun/errores/errores-dominio.js';
import { DatabaseService } from '../database/database.service.js';
import { TerritorioRepositorio, type ResultadoBusqueda } from './territorio.repositorio.js';

export type { ResultadoBusqueda };

@Injectable()
export class TerritorioService {
  constructor(
    private readonly database: DatabaseService,
    private readonly repo: TerritorioRepositorio,
  ) {}

  /** Buscador tolerante a tildes y errores (usa territorio.buscar). */
  async buscar(texto: string, tipo?: string, padre?: number): Promise<ResultadoBusqueda[]> {
    return this.repo.buscar(this.database.db, texto, tipo, padre);
  }

  async municipios() {
    return this.repo.municipios(this.database.db);
  }

  async puestos(municipioId: number) {
    return this.repo.puestos(this.database.db, municipioId);
  }

  async contorno() {
    const fila = await this.repo.contorno(this.database.db);
    if (!fila) throw new NoEncontradoError('No hay departamento cargado');
    return { geojson: fila.geojson, bbox: fila.bbox };
  }

  /**
   * GeoJSON de los hijos de un territorio con su conteo de simpatizantes.
   * Sin `padre`, devuelve los municipios del departamento.
   */
  async mapa(padre?: number) {
    const padreId = padre ?? (await this.repo.departamentoId(this.database.db))?.id;
    if (padreId === undefined) throw new NoEncontradoError('No hay territorio cargado');

    const fila = await this.repo.mapa(this.database.db, padreId);
    return { ...(fila.geojson as object), totalSimpatizantes: fila.total_simpatizantes };
  }
}
