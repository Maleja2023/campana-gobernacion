import { Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { UsuarioSesion } from '../auth/auth.types.js';
import { ReglaNegocioError } from '../comun/errores/errores-dominio.js';
import { DatabaseService } from '../database/database.service.js';
import type { DB } from '../database/db.types.js';
import type { ExportarReporteDto, ReporteQueryDto, TipoReporte } from './dto/reportes.dto.js';
import { construirLibroReporte, type ColumnaReporte } from './reportes-excel.js';
import { ReportesRepositorio } from './reportes.repositorio.js';

/** Columnas del Excel de cada reporte (mismas que muestra la pantalla). */
export const COLUMNAS: Record<TipoReporte, { titulo: string; columnas: ColumnaReporte[] }> = {
  MUNICIPIOS: {
    titulo: 'Por municipio',
    columnas: [
      { titulo: 'Municipio', clave: 'municipio', ancho: 26 },
      { titulo: 'Simpatizantes', clave: 'simpatizantes', tipo: 'numero' },
      { titulo: 'En el periodo', clave: 'en_rango', tipo: 'numero' },
      { titulo: 'Últimos 7 días', clave: 'ultimos_7_dias', tipo: 'numero' },
      { titulo: 'Meta', clave: 'meta', tipo: 'numero' },
      { titulo: 'Avance meta', clave: 'avance_pct', tipo: 'porcentaje' },
      { titulo: 'Líderes', clave: 'lideres', tipo: 'numero' },
      { titulo: 'Líderes activos (7 días)', clave: 'lideres_activos_semana', tipo: 'numero', ancho: 22 },
      { titulo: 'Necesidades', clave: 'necesidades', tipo: 'numero' },
      { titulo: 'Puestos', clave: 'puestos', tipo: 'numero' },
      { titulo: 'Potencial electoral', clave: 'potencial_electoral', tipo: 'numero', ancho: 18 },
      { titulo: 'Cobertura', clave: 'cobertura_pct', tipo: 'porcentaje' },
    ],
  },
  LIDERES: {
    titulo: 'Por líder',
    columnas: [
      { titulo: 'Nombre', clave: 'nombre', ancho: 30 },
      { titulo: 'Cargo', clave: 'cargo_codigo', ancho: 14 },
      { titulo: 'Superior', clave: 'superior', ancho: 30 },
      { titulo: 'Municipio', clave: 'municipio', ancho: 24 },
      { titulo: 'Referidos propios', clave: 'propios', tipo: 'numero' },
      { titulo: 'Total de su red', clave: 'red', tipo: 'numero' },
      { titulo: 'En el periodo', clave: 'en_rango', tipo: 'numero' },
      { titulo: 'Últimos 7 días', clave: 'ultimos_7_dias', tipo: 'numero' },
      { titulo: 'Últimos 30 días', clave: 'ultimos_30_dias', tipo: 'numero' },
      { titulo: 'Último registro', clave: 'ultimo_registro', tipo: 'fecha' },
      { titulo: 'Meta', clave: 'meta', tipo: 'numero' },
      { titulo: 'Avance meta', clave: 'avance_pct', tipo: 'porcentaje' },
      { titulo: 'Intentos duplicados', clave: 'intentos_duplicado', tipo: 'numero' },
      { titulo: 'Alertas abiertas', clave: 'alertas_abiertas', tipo: 'numero' },
    ],
  },
  PUESTOS: {
    titulo: 'Por puesto',
    columnas: [
      { titulo: 'Puesto', clave: 'puesto', ancho: 34 },
      { titulo: 'Municipio', clave: 'municipio', ancho: 24 },
      { titulo: 'Simpatizantes', clave: 'simpatizantes', tipo: 'numero' },
      { titulo: 'Potencial electoral', clave: 'potencial_electoral', tipo: 'numero', ancho: 18 },
      { titulo: 'Cobertura', clave: 'cobertura_pct', tipo: 'porcentaje' },
      { titulo: 'Faltan', clave: 'faltan', tipo: 'numero' },
    ],
  },
  PROYECCION: {
    titulo: 'Proyección de metas',
    columnas: [
      { titulo: 'Tipo', clave: 'tipo', ancho: 12 },
      { titulo: 'Meta de', clave: 'nombre', ancho: 30 },
      { titulo: 'Meta', clave: 'meta', tipo: 'numero' },
      { titulo: 'Registrados', clave: 'registrados', tipo: 'numero' },
      { titulo: 'Fecha límite', clave: 'fecha_limite', tipo: 'fecha' },
      { titulo: 'Días restantes', clave: 'dias_restantes', tipo: 'numero' },
      { titulo: 'Ritmo actual (por día)', clave: 'ritmo_diario', ancho: 20 },
      { titulo: 'Ritmo necesario (por día)', clave: 'ritmo_necesario', ancho: 22 },
      { titulo: 'Proyectado al cierre', clave: 'proyectado', tipo: 'numero', ancho: 20 },
      { titulo: 'Proyectado vs. meta', clave: 'proyectado_pct', tipo: 'porcentaje', ancho: 18 },
      { titulo: 'Fecha estimada de cumplimiento', clave: 'fecha_estimada', tipo: 'fecha', ancho: 26 },
      { titulo: 'Estado', clave: 'estado', ancho: 14 },
    ],
  },
  CALIDAD: {
    titulo: 'Calidad por líder',
    columnas: [
      { titulo: 'Líder', clave: 'nombre', ancho: 30 },
      { titulo: 'Cargo', clave: 'cargo_codigo', ancho: 12 },
      { titulo: 'Municipio', clave: 'municipio', ancho: 24 },
      { titulo: 'Registros activos', clave: 'registros', tipo: 'numero' },
      { titulo: 'Con teléfono', clave: 'con_telefono_pct', tipo: 'porcentaje' },
      { titulo: 'Con puesto', clave: 'con_puesto_pct', tipo: 'porcentaje' },
      { titulo: 'Con vereda o barrio', clave: 'con_zona_pct', tipo: 'porcentaje', ancho: 18 },
      { titulo: 'Intentos duplicados', clave: 'intentos_duplicado', tipo: 'numero' },
      { titulo: 'Personas en alertas', clave: 'personas_en_alertas', tipo: 'numero' },
      { titulo: 'Retirados', clave: 'retirados', tipo: 'numero' },
      { titulo: 'Completitud (de 40)', clave: 'completitud', ancho: 18 },
      { titulo: 'Confiabilidad (de 60)', clave: 'confiabilidad', ancho: 20 },
      { titulo: 'Puntaje (de 100)', clave: 'puntaje', tipo: 'numero', ancho: 16 },
      { titulo: 'Nivel', clave: 'nivel', ancho: 12 },
    ],
  },
};

@Injectable()
export class ReportesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly repo: ReportesRepositorio,
  ) {}

  municipios(usuario: UsuarioSesion, f: ReporteQueryDto) {
    this.validarRango(f);
    return this.database.comoUsuario(usuario.id, (trx) => this.repo.municipios(trx, f));
  }

  lideres(usuario: UsuarioSesion, f: ReporteQueryDto) {
    this.validarRango(f);
    return this.database.comoUsuario(usuario.id, (trx) => this.repo.lideres(trx, f));
  }

  puestos(usuario: UsuarioSesion, f: ReporteQueryDto) {
    this.validarRango(f);
    return this.database.comoUsuario(usuario.id, (trx) => this.repo.puestos(trx, f));
  }

  calidad(usuario: UsuarioSesion, f: ReporteQueryDto) {
    return this.database.comoUsuario(usuario.id, (trx) => this.repo.calidad(trx, f));
  }

  proyeccion(usuario: UsuarioSesion) {
    return this.database.comoUsuario(usuario.id, (trx) => this.repo.proyeccion(trx));
  }

  /** Excel del reporte, con el motivo y lo exportado registrado en la bitácora. */
  async exportar(usuario: UsuarioSesion, dto: ExportarReporteDto): Promise<{ buffer: Buffer; cantidad: number; nombre: string }> {
    this.validarRango(dto);
    const filas = await this.database.comoUsuario(usuario.id, async (trx) => {
      const encontradas = await this.consultar(trx, dto);
      const territorios = [
        ...new Set(encontradas.map((f) => (typeof f.municipio_id === 'number' ? f.municipio_id : dto.municipioId)).filter((id): id is number => id !== undefined)),
      ];
      await this.repo.registrarExportacion(trx, {
        motivo: dto.motivo.trim(),
        cantidad: encontradas.length,
        territorios,
        recurso: `REPORTE_${dto.reporte}`,
      });
      return encontradas;
    });
    const { titulo, columnas } = COLUMNAS[dto.reporte];
    const buffer = await construirLibroReporte(titulo, columnas, filas);
    return { buffer, cantidad: filas.length, nombre: `reporte-${dto.reporte.toLowerCase()}.xlsx` };
  }

  bitacora(usuario: UsuarioSesion, limite: number) {
    return this.database.comoUsuario(usuario.id, (trx) => this.repo.bitacora(trx, limite));
  }

  private consultar(trx: Kysely<DB>, dto: ExportarReporteDto): Promise<Record<string, unknown>[]> {
    switch (dto.reporte) {
      case 'MUNICIPIOS':
        return this.repo.municipios(trx, dto);
      case 'LIDERES':
        return this.repo.lideres(trx, dto);
      case 'PUESTOS':
        return this.repo.puestos(trx, dto);
      case 'PROYECCION':
        return this.repo.proyeccion(trx);
      case 'CALIDAD':
        return this.repo.calidad(trx, dto);
    }
  }

  private validarRango(f: ReporteQueryDto) {
    if (f.desde && f.hasta && f.desde > f.hasta) throw new ReglaNegocioError('La fecha inicial no puede ser posterior a la final');
  }
}
