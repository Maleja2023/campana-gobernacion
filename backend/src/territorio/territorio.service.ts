import { Injectable } from '@nestjs/common';
import { NoEncontradoError, ReglaNegocioError } from '../comun/errores/errores-dominio.js';
import { DatabaseService } from '../database/database.service.js';
import type { UsuarioSesion } from '../auth/auth.types.js';
import type { FiltrosMapaDto } from './dto/mapa-query.dto.js';
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

  async catalogoRegistro() {
    return this.repo.catalogoRegistro(this.database.db);
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
   *
   * Dentro de comoUsuario: los conteos (por territorio y el total del padre)
   * salen de campana.conteo_territorio_visible(), que aplica el alcance del
   * usuario (migración 20). Un territorio fuera de alcance llega en el
   * GeoJSON con simpatizantes null y sinAcceso true, para pintarse en gris.
   */
  async mapa(usuario: UsuarioSesion, padre: number | undefined, filtros: FiltrosMapaDto = {}) {
    this.validarRango(filtros);
    return this.database.comoUsuario(usuario.id, async (trx) => {
      const padreId = padre ?? (await this.repo.departamentoId(trx))?.id;
      if (padreId === undefined) throw new NoEncontradoError('No hay territorio cargado');

      // ~55 m para municipios; ~20 m para veredas y comunas, que son más pequeñas.
      const fila = await this.repo.mapa(trx, padreId, padre === undefined ? 0.0005 : 0.0002, filtros);
      return {
        ...(fila.geojson as object),
        totalSimpatizantes: fila.total_simpatizantes,
        totalSinAcceso: fila.total_sin_acceso,
      };
    });
  }

  /** Puntos con peso para el mapa de calor de registros. */
  async calor(usuario: UsuarioSesion, municipioId: number | undefined, filtros: FiltrosMapaDto) {
    this.validarRango(filtros);
    return this.database.comoUsuario(usuario.id, (trx) => this.repo.calor(trx, municipioId, filtros));
  }

  /** Necesidades por zona (hijos de `padre`), con su reparto por categoría. */
  async necesidades(usuario: UsuarioSesion, padre: number | undefined, categoria?: string) {
    return this.database.comoUsuario(usuario.id, async (trx) => {
      const padreId = padre ?? (await this.repo.departamentoId(trx))?.id;
      if (padreId === undefined) throw new NoEncontradoError('No hay territorio cargado');
      return this.repo.necesidades(trx, padreId, categoria);
    });
  }

  /** Simpatizantes frente al potencial electoral de cada puesto. */
  async brecha(usuario: UsuarioSesion, municipioId: number | undefined, filtros: FiltrosMapaDto) {
    this.validarRango(filtros);
    return this.database.comoUsuario(usuario.id, (trx) => this.repo.brecha(trx, municipioId, filtros));
  }

  /** Coordinadores y líderes que el usuario puede usar como filtro. */
  async miembrosFiltro(usuario: UsuarioSesion) {
    return this.database.comoUsuario(usuario.id, (trx) => this.repo.miembrosFiltro(trx));
  }

  private validarRango(f: FiltrosMapaDto) {
    if (f.desde && f.hasta && f.desde > f.hasta) throw new ReglaNegocioError('La fecha inicial no puede ser posterior a la final');
  }
}
