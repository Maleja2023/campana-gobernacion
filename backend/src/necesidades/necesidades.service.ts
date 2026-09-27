import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { UsuarioSesion } from '../auth/auth.types.js';
import { NoEncontradoError, ReglaNegocioError } from '../comun/errores/errores-dominio.js';
import { DatabaseService } from '../database/database.service.js';
import { clasificarPorReglas } from './categorias.js';
import type { ListadoNecesidadesDto } from './dto/necesidades.dto.js';
import { IaService } from './ia.service.js';
import { NecesidadesRepositorio } from './necesidades.repositorio.js';

export const MODELO_REGLAS = 'reglas-v1';
const TAMANO_LOTE_IA = 25;
const LOTES_POR_CORRIDA = 4;

export interface ResultadoClasificacion {
  modelo: string;
  clasificadas: number;
  fallidas: number;
}

@Injectable()
export class NecesidadesService {
  private readonly logger = new Logger(NecesidadesService.name);
  private enCurso: Promise<ResultadoClasificacion> | null = null;
  /** Informes que se están generando (por municipio) y el último error de cada uno. */
  private readonly informesEnCurso = new Map<number, Promise<void>>();
  private readonly erroresInforme = new Map<number, string>();

  constructor(
    private readonly database: DatabaseService,
    private readonly repo: NecesidadesRepositorio,
    private readonly ia: IaService,
  ) {}

  /** Cada 10 minutos clasifica lo que llegó sin categoría. */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async clasificarProgramado(): Promise<void> {
    try {
      const r = await this.clasificarPendientes();
      if (r.clasificadas || r.fallidas) this.logger.log(`Necesidades clasificadas con ${r.modelo}: ${r.clasificadas} (fallidas: ${r.fallidas})`);
    } catch (error) {
      this.logger.error('No se pudieron clasificar las necesidades', error instanceof Error ? error.stack : error);
    }
  }

  /**
   * Clasifica las necesidades pendientes: con IA si está configurada (hasta
   * 100 por corrida) o con reglas por palabras clave. Una sola corrida a la vez.
   */
  clasificarPendientes(): Promise<ResultadoClasificacion> {
    this.enCurso ??= (this.ia.disponible ? this.clasificarConIaYRespaldo() : this.clasificarConReglas()).finally(() => {
      this.enCurso = null;
    });
    return this.enCurso;
  }

  private async clasificarConReglas(): Promise<ResultadoClasificacion> {
    const db = this.database.db;
    const pendientes = await this.repo.porClasificar(db, MODELO_REGLAS, 200);
    for (const n of pendientes) {
      const c = clasificarPorReglas(n.descripcion);
      await this.repo.guardarClasificacion(db, n.necesidad_id, c.categoria, MODELO_REGLAS, c.confianza);
    }
    return { modelo: MODELO_REGLAS, clasificadas: pendientes.length, fallidas: 0 };
  }

  /** Si la IA falla, lo pendiente se clasifica con reglas mientras tanto:
   * la IA lo reemplaza en una corrida posterior (su confianza es mayor). */
  private async clasificarConIaYRespaldo(): Promise<ResultadoClasificacion> {
    const r = await this.clasificarConIa();
    if (r.fallidas > 0) await this.clasificarConReglas();
    return r;
  }

  private async clasificarConIa(): Promise<ResultadoClasificacion> {
    const db = this.database.db;
    const pendientes = await this.repo.porClasificar(db, this.ia.modelo, TAMANO_LOTE_IA * LOTES_POR_CORRIDA);
    let clasificadas = 0;
    let fallidas = 0;
    for (let i = 0; i < pendientes.length; i += TAMANO_LOTE_IA) {
      const lote = pendientes.slice(i, i + TAMANO_LOTE_IA);
      try {
        const resultado = await this.ia.clasificar(lote.map((n, j) => ({ indice: j, texto: n.descripcion, municipio: n.municipio })));
        for (const c of resultado) {
          await this.repo.guardarClasificacion(db, lote[c.indice].necesidad_id, c.categoria, this.ia.modelo, c.confianza);
        }
        clasificadas += resultado.length;
        fallidas += lote.length - resultado.length;
      } catch (error) {
        // Sin red o sin saldo: lo que quede pendiente se reintenta en la próxima corrida.
        fallidas += lote.length;
        this.logger.warn(`Falló un lote de clasificación con IA: ${IaService.explicarError(error)}`);
        break;
      }
    }
    return { modelo: this.ia.modelo, clasificadas, fallidas };
  }

  async estado(usuario: UsuarioSesion) {
    const modelo = this.ia.disponible ? this.ia.modelo : MODELO_REGLAS;
    const cifras = await this.database.comoUsuario(usuario.id, (trx) => this.repo.estado(trx, modelo));
    return { iaDisponible: this.ia.disponible, modelo, ...cifras };
  }

  async listado(usuario: UsuarioSesion, q: ListadoNecesidadesDto) {
    const filas = await this.database.comoUsuario(usuario.id, (trx) =>
      this.repo.listado(trx, q.municipioId, q.categoria, q.porPagina, (q.pagina - 1) * q.porPagina),
    );
    const total = filas.length ? Number(filas[0].total) : 0;
    return { datos: filas.map(({ total: _t, ...resto }) => resto), total, pagina: q.pagina, porPagina: q.porPagina };
  }

  resumen(usuario: UsuarioSesion) {
    return this.database.comoUsuario(usuario.id, (trx) => this.repo.resumen(trx));
  }

  corregirCategoria(usuario: UsuarioSesion, necesidadId: string, categoria: string) {
    return this.database.comoUsuario(usuario.id, async (trx) => {
      await this.repo.corregirCategoria(trx, necesidadId, categoria);
      return { id: necesidadId, categoria };
    });
  }

  ultimoInforme(usuario: UsuarioSesion, municipioId: number) {
    return this.database.comoUsuario(usuario.id, async (trx) => {
      if (!(await this.repo.municipioVisible(trx, municipioId))) throw new NoEncontradoError('Municipio no encontrado');
      return {
        iaDisponible: this.ia.disponible,
        generando: this.informesEnCurso.has(municipioId),
        error: this.erroresInforme.get(municipioId) ?? null,
        informe: await this.repo.ultimoInforme(trx, municipioId),
      };
    });
  }

  /**
   * Empieza a generar con IA el informe de necesidades del municipio. Corre
   * en segundo plano (puede tardar más de un minuto, más que el tiempo
   * máximo de una petición detrás de Nginx o Cloudflare): la pantalla
   * consulta GET informes/:municipioId hasta que `generando` sea false.
   */
  async generarInforme(usuario: UsuarioSesion, municipioId: number) {
    if (!this.ia.disponible) throw new ReglaNegocioError('La inteligencia artificial no está configurada (falta ANTHROPIC_API_KEY en la API)');
    if (this.informesEnCurso.has(municipioId)) return this.ultimoInforme(usuario, municipioId);

    const insumo = await this.database.comoUsuario(usuario.id, async (trx) => {
      const municipio = await this.repo.municipioVisible(trx, municipioId);
      if (!municipio) throw new NoEncontradoError('Municipio no encontrado');
      const necesidades = await this.repo.insumoInforme(trx, municipioId);
      return { municipio: municipio.nombre, necesidades };
    });
    if (insumo.necesidades.length < 3) throw new ReglaNegocioError('El municipio tiene muy pocas necesidades reportadas para un informe');

    const conteo = new Map<string, number>();
    for (const n of insumo.necesidades) conteo.set(n.categoria, (conteo.get(n.categoria) ?? 0) + 1);
    const resumen = [...conteo].map(([categoria, cantidad]) => ({ categoria, cantidad })).sort((a, b) => b.cantidad - a.cantidad);

    this.erroresInforme.delete(municipioId);
    const tarea = (async () => {
      try {
        const contenido = await this.ia.informe({ municipio: insumo.municipio, resumen, necesidades: insumo.necesidades });
        await this.database.comoUsuario(usuario.id, (trx) =>
          this.repo.guardarInforme(trx, { municipioId, modelo: this.ia.modelo, total: insumo.necesidades.length, contenido }),
        );
      } catch (error) {
        this.logger.warn(`No se pudo generar el informe con IA: ${error instanceof Error ? error.message : String(error)}`);
        this.erroresInforme.set(municipioId, IaService.explicarError(error));
      } finally {
        this.informesEnCurso.delete(municipioId);
      }
    })();
    this.informesEnCurso.set(municipioId, tarea);
    return this.ultimoInforme(usuario, municipioId);
  }
}
