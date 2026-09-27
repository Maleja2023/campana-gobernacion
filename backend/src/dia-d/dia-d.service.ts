import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import type { UsuarioSesion } from '../auth/auth.types.js';
import { NoEncontradoError, ReglaNegocioError } from '../comun/errores/errores-dominio.js';
import { DatabaseService } from '../database/database.service.js';
import { DiaDRepositorio } from './dia-d.repositorio.js';
import type { CandidatoDto, CargarE14Dto, JornadaDto } from './dto/dia-d.dto.js';

export interface ArchivoSubido {
  buffer: Buffer;
  size: number;
}

export const TAMANO_MAXIMO_FOTO = 8 * 1024 * 1024;

/** Tipo de imagen por sus primeros bytes (no por lo que diga el navegador). */
export function tipoImagen(b: Buffer): 'jpg' | 'png' | 'webp' | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

const CONTENT_TYPE = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' } as const;

@Injectable()
export class DiaDService {
  private readonly directorio: string;

  constructor(
    private readonly database: DatabaseService,
    private readonly repo: DiaDRepositorio,
    config: ConfigService,
  ) {
    this.directorio = resolve(config.get<string>('E14_DIRECTORIO') || 'almacen/e14');
  }

  jornadas(u: UsuarioSesion) {
    return this.database.comoUsuario(u.id, (trx) => this.repo.jornadas(trx));
  }

  async crearJornada(u: UsuarioSesion, dto: JornadaDto) {
    const id = await this.database.comoUsuario(u.id, (trx) => this.repo.crearJornada(trx, dto.nombre.trim(), dto.tipo, dto.fecha, dto.copiarDe));
    return { id };
  }

  opciones(u: UsuarioSesion, corporacion: string) {
    return this.database.comoUsuario(u.id, (trx) => this.repo.opciones(trx, corporacion));
  }

  async guardarCandidato(u: UsuarioSesion, dto: CandidatoDto) {
    const id = await this.database.comoUsuario(u.id, (trx) =>
      this.repo.guardarCandidato(trx, dto.corporacion, dto.nombre.trim(), dto.partido?.trim() || null, dto.propio),
    );
    return { id };
  }

  async quitarCandidato(u: UsuarioSesion, id: number) {
    await this.database.comoUsuario(u.id, (trx) => this.repo.quitarCandidato(trx, id));
    return { id };
  }

  puestos(u: UsuarioSesion, municipioId?: number) {
    return this.database.comoUsuario(u.id, (trx) => this.repo.puestos(trx, municipioId ?? null));
  }

  async definirMesas(u: UsuarioSesion, puestoId: number, cantidad: number) {
    await this.database.comoUsuario(u.id, (trx) => this.repo.definirMesas(trx, puestoId, cantidad));
    return { puestoId, cantidad };
  }

  mesasPuesto(u: UsuarioSesion, puestoId: number) {
    return this.database.comoUsuario(u.id, (trx) => this.repo.mesasPuesto(trx, puestoId));
  }

  testigos(u: UsuarioSesion) {
    return this.database.comoUsuario(u.id, (trx) => this.repo.testigosDisponibles(trx));
  }

  async asignarTestigo(u: UsuarioSesion, mesaId: number, usuarioId: string | null) {
    await this.database.comoUsuario(u.id, (trx) => this.repo.asignarTestigo(trx, mesaId, usuarioId));
    return { mesaId, usuarioId };
  }

  misMesas(u: UsuarioSesion) {
    return this.database.comoUsuario(u.id, (trx) => this.repo.misMesas(trx));
  }

  /**
   * Guarda la foto con su huella (sha256) como nombre, y los votos. La base
   * verifica que la mesa sea del testigo antes de aceptar nada; si lo
   * rechaza, la foto queda sin referencia y no se sirve a nadie.
   */
  async cargarE14(u: UsuarioSesion, dto: CargarE14Dto, archivo: ArchivoSubido | undefined) {
    if (!archivo?.buffer?.length) throw new ReglaNegocioError('Falta la foto del formulario E-14');
    if (archivo.size > TAMANO_MAXIMO_FOTO) throw new ReglaNegocioError('La foto pesa más de 8 MB');
    const tipo = tipoImagen(archivo.buffer);
    if (!tipo) throw new ReglaNegocioError('La foto debe ser JPG, PNG o WEBP');

    let votos: Record<string, number>;
    try {
      votos = JSON.parse(dto.votos) as Record<string, number>;
    } catch {
      throw new ReglaNegocioError('Votos con formato no válido');
    }
    if (!Object.values(votos).every((v) => Number.isInteger(v) && v >= 0 && v <= 9999)) {
      throw new ReglaNegocioError('Los votos deben ser números enteros entre 0 y 9999');
    }

    const sha256 = createHash('sha256').update(archivo.buffer).digest();
    const nombre = `${sha256.toString('hex')}.${tipo}`;
    await mkdir(this.directorio, { recursive: true, mode: 0o700 });
    await writeFile(join(this.directorio, nombre), archivo.buffer, { mode: 0o600 });

    const r = await this.database.comoUsuario(u.id, (trx) => this.repo.cargarE14(trx, dto.mesaId, dto.corporacion, nombre, sha256, votos));
    return {
      formularioId: r.formulario_id,
      estado: r.estado_revision,
      total: r.total,
      mensaje:
        r.estado_revision === 'CON_INCONSISTENCIAS'
          ? 'Guardado, pero la suma de votos es mayor a la esperada para una mesa: revisa los números.'
          : 'E-14 guardado. Gracias.',
    };
  }

  /** Foto del E-14, verificando permiso e integridad (sha256). */
  async fotoE14(u: UsuarioSesion, formularioId: string) {
    const f = await this.database.comoUsuario(u.id, (trx) => this.repo.fotoE14(trx, formularioId));
    if (!f) throw new NoEncontradoError('Formulario no encontrado');
    const nombre = basename(f.ruta);
    const contenido = await readFile(join(this.directorio, nombre)).catch(() => null);
    if (!contenido) throw new NoEncontradoError('La foto no está en el servidor');
    if (!createHash('sha256').update(contenido).digest().equals(Buffer.from(f.sha256))) {
      throw new ReglaNegocioError('La foto guardada no coincide con la huella registrada: fue modificada');
    }
    const tipo = tipoImagen(contenido) ?? 'jpg';
    return { contenido, contentType: CONTENT_TYPE[tipo] };
  }

  revision(u: UsuarioSesion, estado?: string, municipioId?: number) {
    return this.database.comoUsuario(u.id, (trx) => this.repo.revision(trx, estado ?? null, municipioId ?? null));
  }

  async revisar(u: UsuarioSesion, id: string, estado: string, observacion?: string) {
    await this.database.comoUsuario(u.id, (trx) => this.repo.revisar(trx, id, estado, observacion ?? null));
    return { id, estado };
  }

  conteo(u: UsuarioSesion, corporacion: string, municipioId?: number) {
    return this.database.comoUsuario(u.id, (trx) => this.repo.conteo(trx, corporacion, municipioId ?? null));
  }
}
