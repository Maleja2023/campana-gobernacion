import { Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { randomUUID } from 'node:crypto';
import type { UsuarioSesion } from '../auth/auth.types.js';
import { NoEncontradoError, ReglaNegocioError } from '../comun/errores/errores-dominio.js';
import { DatabaseService } from '../database/database.service.js';
import type { DB } from '../database/db.types.js';
import { AgendaRepositorio } from './agenda.repositorio.js';
import type {
  ActualizarCompromisoDto,
  ActualizarVisitaDto,
  CompromisoDto,
  CompromisosQueryDto,
  PlanteamientoDto,
  ReporteDto,
  VisitaDto,
  VisitasQueryDto,
} from './dto/agenda.dto.js';

@Injectable()
export class AgendaService {
  constructor(
    private readonly database: DatabaseService,
    private readonly repo: AgendaRepositorio,
  ) {}

  async visitas(u: UsuarioSesion, q: VisitasQueryDto) {
    return this.database.comoUsuario(u.id, async (trx) => {
      const { datos, total } = await this.repo.listarVisitas(trx, q);
      return { datos, total, pagina: q.pagina, porPagina: q.porPagina };
    });
  }

  async visita(u: UsuarioSesion, id: string) {
    return this.database.comoUsuario(u.id, async (trx) => {
      const visita = await this.repo.visitaPorId(trx, id);
      if (!visita) throw new NoEncontradoError('Visita no encontrada');
      const [lideres, organizaciones, planteamientos, compromisos] = await Promise.all([
        this.repo.lideresPresentes(trx, id),
        this.repo.organizacionesPresentes(trx, id),
        this.repo.planteamientosDeEvento(trx, id),
        this.repo.compromisosDeEvento(trx, id),
      ]);
      return { visita, lideres, organizaciones, planteamientos, compromisos };
    });
  }

  async crearVisita(u: UsuarioSesion, dto: VisitaDto) {
    return this.database.comoUsuario(u.id, async (trx) => {
      this.validarFechas(dto.iniciaEn, dto.terminaEn);
      this.validarCoordenadas(dto.lon, dto.lat);
      await this.validarLideres(trx, dto.liderIds);
      const id = randomUUID();
      await this.repo.crearVisita(trx, id, u, dto);
      await this.repo.reemplazarAcompanantes(trx, id, dto.liderIds, dto.organizaciones);
      return { id };
    });
  }

  async actualizarVisita(u: UsuarioSesion, id: string, dto: ActualizarVisitaDto) {
    return this.database.comoUsuario(u.id, async (trx) => {
      const existente = await this.repo.eventoFechas(trx, id);
      if (!existente) throw new NoEncontradoError('Visita no encontrada');
      if (dto.iniciaEn || dto.terminaEn) {
        this.validarFechas(dto.iniciaEn ?? existente.inicia_en, dto.terminaEn ?? existente.termina_en);
      }
      if (dto.liderIds) await this.validarLideres(trx, dto.liderIds);

      await this.repo.actualizarVisita(trx, id, dto);
      if (dto.liderIds || dto.organizaciones) {
        await this.repo.reemplazarAcompanantes(trx, id, dto.liderIds ?? [], dto.organizaciones ?? []);
      }
      return { id };
    });
  }

  async planteamiento(u: UsuarioSesion, id: string, dto: PlanteamientoDto) {
    return this.database.comoUsuario(u.id, async (trx) => {
      const visita = await this.repo.eventoTerritorio(trx, id);
      if (!visita) throw new NoEncontradoError('Visita no encontrada');
      const necesidadId = randomUUID();
      await this.repo.crearPlanteamiento(trx, necesidadId, {
        territorioId: dto.territorioId ?? visita.territorio_id,
        descripcion: dto.descripcion.trim(),
        categoria: dto.categoria,
        eventoId: id,
        reportadoPor: u.id,
        prioridad: dto.prioridad,
      });
      return { id: necesidadId };
    });
  }

  async reporte(u: UsuarioSesion, dto: ReporteDto) {
    return this.database.comoUsuario(u.id, async (trx) => {
      const id = randomUUID();
      await this.repo.crearReporte(trx, id, {
        territorioId: dto.territorioId,
        descripcion: dto.descripcion.trim(),
        categoria: dto.categoria,
        reportadoPor: u.id,
        prioridad: dto.prioridad,
      });
      return { id };
    });
  }

  async misReportes(u: UsuarioSesion) {
    return this.database.comoUsuario(u.id, (trx) => this.repo.misReportes(trx, u.id));
  }

  async compromisos(u: UsuarioSesion, q: CompromisosQueryDto) {
    return this.database.comoUsuario(u.id, (trx) => this.repo.compromisos(trx, q));
  }

  async crearCompromiso(u: UsuarioSesion, dto: CompromisoDto) {
    return this.database.comoUsuario(u.id, async (trx) => {
      const id = randomUUID();
      await this.repo.crearCompromiso(trx, id, u.id, dto);
      return { id };
    });
  }

  async actualizarCompromiso(u: UsuarioSesion, id: string, dto: ActualizarCompromisoDto) {
    if (dto.estado === 'EN_PROGRAMA' && !dto.propuestaId) throw new ReglaNegocioError('EN_PROGRAMA requiere propuestaId');
    return this.database.comoUsuario(u.id, async (trx) => {
      const resultado = await this.repo.actualizarCompromiso(trx, id, dto.estado, dto.propuestaId ?? null);
      if (!resultado) throw new NoEncontradoError('Compromiso no encontrado');
      return resultado;
    });
  }

  async cobertura(u: UsuarioSesion, padre?: number) {
    return this.database.comoUsuario(u.id, async (trx) => {
      const parent = padre ?? (await this.repo.departamentoId(trx));
      if (!parent) throw new NoEncontradoError('No hay territorio cargado');
      return this.repo.cobertura(trx, parent);
    });
  }

  async catalogos(u: UsuarioSesion) {
    return this.database.comoUsuario(u.id, (trx) => this.repo.catalogos(trx));
  }

  private async validarLideres(trx: Kysely<DB>, ids: string[]) {
    if (!ids.length) return;
    const activos = await this.repo.lideresActivosEntre(trx, ids);
    if (activos.length !== new Set(ids).size) throw new ReglaNegocioError('Uno o más líderes no existen o están inactivos');
  }

  private validarCoordenadas(lon?: number, lat?: number) {
    if ((lon === undefined) !== (lat === undefined)) throw new ReglaNegocioError('La ubicación debe incluir longitud y latitud');
    if (lon !== undefined && (lon < -180 || lon > 180 || lat! < -90 || lat! > 90)) {
      throw new ReglaNegocioError('La ubicación no es válida');
    }
  }

  private validarFechas(a: string, b: string) {
    if (new Date(b) < new Date(a)) throw new ReglaNegocioError('terminaEn debe ser posterior o igual a iniciaEn');
  }
}
