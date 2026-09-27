import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { UsuarioSesion } from '../auth/auth.types.js';
import { CifradoService } from '../cifrado/cifrado.service.js';
import { CaptchaService } from '../comun/captcha/captcha.service.js';
import { NoEncontradoError } from '../comun/errores/errores-dominio.js';
import { DatabaseService } from '../database/database.service.js';
import type { BajaDto, BitacoraDto, RadicarSolicitudDto } from './dto/titular.dto.js';
import { TitularRepositorio } from './titular.repositorio.js';

const POR_PAGINA_BITACORA = 50;

@Injectable()
export class TitularService {
  private readonly responsable: { nombre: string; correo: string | null; telefono: string | null };

  constructor(
    private readonly database: DatabaseService,
    private readonly cifrado: CifradoService,
    private readonly captcha: CaptchaService,
    private readonly repo: TitularRepositorio,
    config: ConfigService,
  ) {
    this.responsable = {
      nombre: config.get<string>('RESPONSABLE_NOMBRE') || 'Campaña a la Gobernación del Caquetá',
      correo: config.get<string>('RESPONSABLE_CORREO') || null,
      telefono: config.get<string>('RESPONSABLE_TELEFONO') || null,
    };
  }

  /** Quién responde por los datos (lo muestra la página pública de privacidad). */
  responsableDatos() {
    return this.responsable;
  }

  private hashDocumento(documento: string) {
    return this.cifrado.hash(this.cifrado.normalizarNumero(documento));
  }

  /**
   * Radica una solicitud del titular. No revela si la cédula está en la base:
   * la respuesta es la misma. La persona se asocia por la cédula, si existe.
   */
  async radicar(dto: RadicarSolicitudDto, ip: string | null) {
    await this.captcha.verificar(dto.captcha, ip);
    const r = await this.database.comoUsuario(null, (trx) =>
      this.repo.radicar(trx, {
        tipo: dto.tipo,
        documentoHash: this.hashDocumento(dto.documento),
        contacto: dto.contacto.trim(),
        descripcion: dto.descripcion.trim(),
      }),
    );
    return { radicado: r.radicado, fechaLimite: r.fecha_limite };
  }

  async estado(radicado: string, documento: string) {
    const r = await this.database.comoUsuario(null, (trx) => this.repo.estado(trx, radicado.trim().toUpperCase(), this.hashDocumento(documento)));
    if (!r) throw new NoEncontradoError('No hay una solicitud con ese radicado para esa cédula');
    return r;
  }

  /** Baja de mensajes: queda excluida de inmediato de todo envío. No revela si la cédula existe. */
  async baja(dto: BajaDto, ip: string | null) {
    await this.captcha.verificar(dto.captcha, ip);
    await this.database.comoUsuario(null, (trx) => this.repo.bajaPorDocumento(trx, this.hashDocumento(dto.documento), dto.canal ?? null));
    return { mensaje: 'Listo. Si tus datos están en la campaña, no recibirás más mensajes por ese medio.' };
  }

  listado(usuario: UsuarioSesion, estado?: string) {
    return this.database.comoUsuario(usuario.id, (trx) => this.repo.listado(trx, estado));
  }

  /** Datos que la campaña tiene del titular, con cédula y teléfonos descifrados (queda en la bitácora). */
  async datos(usuario: UsuarioSesion, id: string) {
    const datos = await this.database.comoUsuario(usuario.id, (trx) => this.repo.datos(trx, id));
    if (!datos) return null;
    const { documento_cifrado, telefonos_cifrados, ...resto } = datos as {
      documento_cifrado: string | null;
      telefonos_cifrados: string[];
    } & Record<string, unknown>;
    return {
      ...resto,
      documento: documento_cifrado ? this.cifrado.descifrar(Buffer.from(documento_cifrado, 'base64')) : null,
      telefonos: (telefonos_cifrados ?? []).map((t) => this.cifrado.descifrar(Buffer.from(t, 'base64'))),
    };
  }

  async tramitar(usuario: UsuarioSesion, id: string, accion: string, respuesta?: string) {
    await this.database.comoUsuario(usuario.id, (trx) => this.repo.tramitar(trx, id, accion, respuesta?.trim() || null));
    return { id, accion };
  }

  async bitacora(usuario: UsuarioSesion, f: BitacoraDto) {
    const filas = await this.database.comoUsuario(usuario.id, (trx) => this.repo.bitacora(trx, f, POR_PAGINA_BITACORA, (f.pagina - 1) * POR_PAGINA_BITACORA));
    return {
      datos: filas.map(({ total: _t, ...r }) => r),
      total: filas.length ? Number(filas[0].total) : 0,
      pagina: f.pagina,
      porPagina: POR_PAGINA_BITACORA,
    };
  }
}
