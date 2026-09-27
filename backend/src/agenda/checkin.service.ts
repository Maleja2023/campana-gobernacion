import { Injectable } from '@nestjs/common';
import type { UsuarioSesion } from '../auth/auth.types.js';
import { CifradoService } from '../cifrado/cifrado.service.js';
import { CaptchaService } from '../comun/captcha/captcha.service.js';
import { NoEncontradoError, ReglaNegocioError } from '../comun/errores/errores-dominio.js';
import { DatabaseService } from '../database/database.service.js';
import { CheckinRepositorio } from './checkin.repositorio.js';
import type { CheckinDto, ComparativoDto } from './dto/checkin.dto.js';

/** Qué le decimos al asistente según el resultado del check-in. */
const MENSAJES: Record<string, { ok: boolean; mensaje: string }> = {
  ASISTENCIA: { ok: true, mensaje: '¡Listo! Tu asistencia quedó registrada. Gracias por venir.' },
  REGISTRADO: { ok: true, mensaje: '¡Listo! Tu asistencia quedó registrada. Gracias por venir.' },
  YA_REGISTRADA: { ok: true, mensaje: 'Tu asistencia ya estaba registrada. Gracias por venir.' },
  FUERA_DE_HORARIO: { ok: false, mensaje: 'El registro de asistencia de este evento no está abierto en este momento.' },
  EVENTO_INVALIDO: { ok: false, mensaje: 'Este código de evento no existe o el evento fue cancelado.' },
  SIN_REFERENTE: { ok: false, mensaje: 'Este evento no está recibiendo registros nuevos. Pide ayuda al equipo organizador.' },
};

@Injectable()
export class CheckinService {
  constructor(
    private readonly database: DatabaseService,
    private readonly cifrado: CifradoService,
    private readonly captcha: CaptchaService,
    private readonly repo: CheckinRepositorio,
  ) {}

  private normalizarCodigo(codigo: string) {
    const limpio = codigo.trim().toUpperCase();
    if (!/^[A-Z0-9]{6,20}$/.test(limpio)) throw new NoEncontradoError('Evento no encontrado');
    return limpio;
  }

  async info(codigo: string) {
    const info = await this.database.comoUsuario(null, (trx) => this.repo.infoPublica(trx, this.normalizarCodigo(codigo)));
    if (!info || info.estado === 'CANCELADA') throw new NoEncontradoError('Este código de evento no existe o el evento fue cancelado');
    return info;
  }

  /**
   * Check-in público. La respuesta es la misma si la persona ya estaba en la
   * base o si se acaba de registrar, para no revelar quién está.
   */
  async checkin(codigo: string, dto: CheckinDto, ip: string | null, userAgent: string | null) {
    await this.captcha.verificar(dto.captcha, ip);
    if (dto.aceptaPolitica !== true || !dto.finalidades.includes('ORGANIZACION_CAMPANA')) {
      throw new ReglaNegocioError('Debes aceptar la política de tratamiento de datos');
    }
    const documento = this.cifrado.normalizarNumero(dto.documento);
    const telefono = dto.telefono ? this.cifrado.normalizarNumero(dto.telefono) : null;
    const resultado = await this.database.comoUsuario(null, (trx) =>
      this.repo.checkinPublico(trx, {
        codigo: this.normalizarCodigo(codigo),
        documentoHash: this.cifrado.hash(documento),
        documentoCifrado: this.cifrado.cifrar(documento),
        nombres: dto.nombres.trim(),
        apellidos: dto.apellidos.trim(),
        telefonoHash: telefono ? this.cifrado.hash(telefono) : null,
        telefonoCifrado: telefono ? this.cifrado.cifrar(telefono) : null,
        territorioId: dto.territorioId,
        politicaVersion: dto.politicaVersion,
        finalidades: dto.finalidades,
        ip,
        userAgent: userAgent?.slice(0, 300) ?? null,
      }),
    );
    const r = MENSAJES[resultado] ?? MENSAJES.EVENTO_INVALIDO;
    if (!r.ok) throw new ReglaNegocioError(r.mensaje);
    return { mensaje: r.mensaje };
  }

  /** Código del QR y asistentes del evento, para el equipo. */
  async asistencia(u: UsuarioSesion, eventoId: string) {
    return this.database.comoUsuario(u.id, async (trx) => {
      const evento = await this.repo.codigoEvento(trx, eventoId);
      if (!evento) throw new NoEncontradoError('Visita no encontrada');
      const asistentes = await this.repo.asistentes(trx, eventoId);
      return {
        codigo: evento.codigo_checkin,
        asistentes,
        total: asistentes.length,
        nuevos: asistentes.filter((a) => a.nuevo).length,
      };
    });
  }

  async marcar(u: UsuarioSesion, eventoId: string, documento: string) {
    const hash = this.cifrado.hash(this.cifrado.normalizarNumero(documento));
    const r = await this.database.comoUsuario(u.id, (trx) => this.repo.marcarAsistencia(trx, eventoId, hash));
    if (r.resultado === 'EVENTO_INVALIDO') throw new NoEncontradoError('Visita no encontrada o cancelada');
    if (r.resultado === 'NO_ENCONTRADA') {
      throw new NoEncontradoError('No encontramos esa cédula entre las personas de tu alcance. Pídele que se registre con el QR del evento.');
    }
    return { resultado: r.resultado, nombre: r.nombre };
  }

  comparativo(u: UsuarioSesion, q: ComparativoDto) {
    if (q.desde > q.hasta) throw new ReglaNegocioError('La fecha inicial no puede ser posterior a la final');
    return this.database.comoUsuario(u.id, (trx) => this.repo.comparativo(trx, q.desde, q.hasta, q.municipioId ?? null));
  }
}
