import { Injectable } from '@nestjs/common';
import { ReglaNegocioError } from '../comun/errores/errores-dominio.js';
import { DatabaseService } from '../database/database.service.js';
import type { UsuarioSesion } from '../auth/auth.types.js';
import { TableroRepositorio } from './tablero.repositorio.js';

const DIAS_POR_DEFECTO = 30;
const DIAS_MAXIMOS = 366;

@Injectable()
export class TableroService {
  constructor(
    private readonly database: DatabaseService,
    private readonly repo: TableroRepositorio,
  ) {}

  async indicadores(usuario: UsuarioSesion) {
    return this.database.comoUsuario(usuario.id, (trx) => this.repo.indicadores(trx));
  }

  async registrosDiarios(usuario: UsuarioSesion, desde?: string, hasta?: string, municipioId?: number) {
    const rango = this.rangoFechas(desde, hasta);
    return this.database.comoUsuario(usuario.id, (trx) => this.repo.registrosDiarios(trx, rango.desde, rango.hasta, municipioId));
  }

  async ranking(usuario: UsuarioSesion, limite: number) {
    return this.database.comoUsuario(usuario.id, (trx) => this.repo.ranking(trx, limite));
  }

  async lideresInactivos(usuario: UsuarioSesion) {
    return this.database.comoUsuario(usuario.id, (trx) => this.repo.lideresInactivos(trx));
  }

  /** Parámetros que la pantalla necesita para explicar las alertas. */
  async configuracion(usuario: UsuarioSesion) {
    return this.database.comoUsuario(usuario.id, async (trx) => ({ liderInactivoDias: await this.repo.diasInactividad(trx) }));
  }

  async metas(usuario: UsuarioSesion) {
    return this.database.comoUsuario(usuario.id, async (trx) => {
      const [miembros, territorios] = await Promise.all([this.repo.metasMiembro(trx), this.repo.metasTerritorio(trx)]);
      return { miembros, territorios };
    });
  }

  async necesidades(usuario: UsuarioSesion, municipioId?: number) {
    return this.database.comoUsuario(usuario.id, async (trx) => {
      const [porMunicipio, sinPropuesta] = await Promise.all([
        this.repo.necesidadesPorMunicipio(trx, municipioId),
        this.repo.necesidadesSinPropuesta(trx),
      ]);
      return { porMunicipio, sinPropuesta };
    });
  }

  async puestos(usuario: UsuarioSesion, municipioId?: number) {
    return this.database.comoUsuario(usuario.id, (trx) => this.repo.puestos(trx, municipioId));
  }

  private rangoFechas(desde?: string, hasta?: string): { desde: string; hasta: string } {
    const fin = hasta ? new Date(`${hasta}T00:00:00.000Z`) : new Date();
    const inicio = desde
      ? new Date(`${desde}T00:00:00.000Z`)
      : new Date(fin.getTime() - (DIAS_POR_DEFECTO - 1) * 24 * 60 * 60 * 1000);
    if (Number.isNaN(inicio.getTime()) || Number.isNaN(fin.getTime()) || inicio > fin) {
      throw new ReglaNegocioError('El rango de fechas no es válido');
    }
    const dias = Math.floor((fin.getTime() - inicio.getTime()) / (24 * 60 * 60 * 1000)) + 1;
    if (dias > DIAS_MAXIMOS) throw new ReglaNegocioError('El rango máximo es de 366 días');
    return { desde: inicio.toISOString().slice(0, 10), hasta: fin.toISOString().slice(0, 10) };
  }
}
