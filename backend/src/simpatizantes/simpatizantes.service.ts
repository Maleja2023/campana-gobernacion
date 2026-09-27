import { Injectable } from '@nestjs/common';
import { CifradoService } from '../cifrado/cifrado.service.js';
import { CaptchaService } from '../comun/captcha/captcha.service.js';
import { ConflictoError, NoEncontradoError, ReglaNegocioError } from '../comun/errores/errores-dominio.js';
import { DatabaseService } from '../database/database.service.js';
import type { UsuarioSesion } from '../auth/auth.types.js';
import type { EditarSimpatizanteDto } from './dto/editar-simpatizante.dto.js';
import type { ExportarSimpatizantesDto } from './dto/exportar-simpatizantes.dto.js';
import type { RegistroSimpatizanteDto } from './dto/registro-simpatizante.dto.js';
import { construirLibroSimpatizantes } from './exportar-excel.js';
import { SimpatizantesRepositorio } from './simpatizantes.repositorio.js';

/** Tiempo máximo que un registro puede esperar en el celular antes de enviarse. */
export const DIAS_MAXIMOS_SIN_CONEXION = 30;

export interface Politica {
  version: number;
  texto: string;
  finalidades: { codigo: string; descripcion: string }[];
}

@Injectable()
export class SimpatizantesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly cifrado: CifradoService,
    private readonly repo: SimpatizantesRepositorio,
    private readonly captcha: CaptchaService,
  ) {}

  async politica(): Promise<Politica> {
    return this.database.comoUsuario(null, async (trx) => {
      const politica = await this.repo.politicaVigente(trx);
      if (!politica) throw new NoEncontradoError('No hay una política vigente');
      const finalidades = await this.repo.finalidadesDePolitica(trx, politica.version);
      return { ...politica, finalidades };
    });
  }

  async validarLink(codigo: string) {
    return this.database.comoUsuario(null, async (trx) => {
      const link = await this.repo.linkValido(trx, codigo.trim().toUpperCase());
      return link ? { valido: true, lider: link.nombres.trim().split(/\s+/)[0] } : { valido: false };
    });
  }

  configuracionRegistro() {
    return { captchaSiteKey: this.captcha.siteKey };
  }

  async autorregistro(dto: RegistroSimpatizanteDto, ip: string | null, userAgent: string | null) {
    await this.captcha.verificar(dto.captcha, ip);
    return this.registrar(dto, dto.codigoLink, dto.canal, null, ip, userAgent, false);
  }

  async crear(dto: RegistroSimpatizanteDto, usuario: UsuarioSesion, ip: string | null, userAgent: string | null) {
    const capturadoEn = this.validarCaptura(dto.capturadoEn);
    const codigo = dto.codigoLink ? await this.linkPermitido(usuario, dto.codigoLink) : await this.linkPrincipal(usuario.id);
    return this.registrar(dto, codigo, 'DIGITADOR', usuario.id, ip, userAgent, true, capturadoEn);
  }

  async listar(
    usuario: UsuarioSesion,
    filtros: {
      municipioId?: number;
      territorioId?: number;
      estado?: string;
      texto?: string;
      liderId?: string;
      desde?: string;
      hasta?: string;
      pagina: number;
      porPagina: number;
    },
  ) {
    this.validarRangoFechas(filtros.desde, filtros.hasta);
    return this.database.comoUsuario(usuario.id, async (trx) => {
      const territoriosDescendientes =
        filtros.territorioId !== undefined ? await this.repo.descendientesDe(trx, filtros.territorioId) : undefined;
      if (filtros.liderId !== undefined && !(await this.repo.miembroEnMiRed(trx, filtros.liderId))) {
        throw new NoEncontradoError('Líder no encontrado');
      }

      const { datos, total } = await this.repo.listar(trx, {
        municipioId: filtros.municipioId,
        territoriosDescendientes,
        estado: filtros.estado,
        texto: filtros.texto,
        liderId: filtros.liderId,
        desde: filtros.desde,
        hasta: filtros.hasta,
        pagina: filtros.pagina,
        porPagina: filtros.porPagina,
      });
      return { datos, total, pagina: filtros.pagina, porPagina: filtros.porPagina };
    });
  }

  private validarRangoFechas(desde?: string, hasta?: string) {
    if (!desde && !hasta) return;
    const inicio = desde ? new Date(`${desde}T00:00:00.000Z`) : undefined;
    const fin = hasta ? new Date(`${hasta}T00:00:00.000Z`) : undefined;
    if ((inicio && Number.isNaN(inicio.getTime())) || (fin && Number.isNaN(fin.getTime()))) {
      throw new ReglaNegocioError('La fecha indicada no es válida');
    }
    if (inicio && fin && inicio > fin) throw new ReglaNegocioError('La fecha "desde" debe ser anterior o igual a "hasta"');
  }

  async documento(usuario: UsuarioSesion, personaId: string) {
    return this.database.comoUsuario(usuario.id, async (trx) => {
      let persona: { documento_cifrado: Buffer } | undefined;
      try {
        persona = await this.repo.documentoCifradoDe(trx, personaId);
      } finally {
        await this.repo.registrarConsultaAuditada(trx, personaId);
      }
      if (!persona) throw new NoEncontradoError('Registro no encontrado');
      return { documento: this.cifrado.descifrar(persona.documento_cifrado) };
    });
  }

  async editar(usuario: UsuarioSesion, personaId: string, dto: EditarSimpatizanteDto) {
    const vacio = [dto.nombres, dto.apellidos, dto.telefono, dto.territorioId, dto.puestoId].every((v) => v === undefined);
    if (vacio) throw new ReglaNegocioError('No se envió ningún cambio');
    return this.database.comoUsuario(usuario.id, async (trx) => {
      if (!(await this.repo.visible(trx, personaId))) throw new NoEncontradoError('Simpatizante no encontrado');

      const telefono = dto.telefono ? this.cifrado.normalizarNumero(dto.telefono) : null;
      await this.repo.editar(trx, {
        personaId,
        nombres: dto.nombres?.trim() ?? null,
        apellidos: dto.apellidos?.trim() ?? null,
        territorioId: dto.territorioId ?? null,
        telefonoHash: telefono ? this.cifrado.hash(telefono) : null,
        telefonoCifrado: telefono ? this.cifrado.cifrar(telefono) : null,
        puestoId: dto.puestoId ?? null,
      });
      return { mensaje: 'Datos actualizados' };
    });
  }

  async retirar(usuario: UsuarioSesion, personaId: string, motivo: string) {
    return this.database.comoUsuario(usuario.id, async (trx) => {
      if (!(await this.repo.visible(trx, personaId))) throw new NoEncontradoError('Simpatizante no encontrado');
      await this.repo.retirar(trx, personaId, motivo.trim());
      return { mensaje: 'Simpatizante retirado' };
    });
  }

  async reactivar(usuario: UsuarioSesion, personaId: string) {
    return this.database.comoUsuario(usuario.id, async (trx) => {
      if (!(await this.repo.visible(trx, personaId))) throw new NoEncontradoError('Simpatizante no encontrado');
      await this.repo.reactivar(trx, personaId);
      return { mensaje: 'Simpatizante reactivado' };
    });
  }

  async historial(usuario: UsuarioSesion, personaId: string) {
    return this.database.comoUsuario(usuario.id, async (trx) => {
      if (!(await this.repo.visible(trx, personaId))) throw new NoEncontradoError('Simpatizante no encontrado');
      return this.repo.historial(trx, personaId);
    });
  }

  /** Líderes que el usuario puede elegir como "líder que refiere" al registrar. */
  async lideresParaRegistro(usuario: UsuarioSesion) {
    return this.database.comoUsuario(usuario.id, (trx) => this.repo.lideresParaRegistro(trx));
  }

  /** Lee las filas y deja constancia auditada de quién exportó, con qué motivo
   * y cuántos registros (auditoria.exportaciones), en una sola transacción. El
   * armado del Excel queda fuera: es trabajo de CPU y no debe retener una
   * conexión del pool. Si la auditoría falla, no se entrega ningún archivo. */
  async exportar(usuario: UsuarioSesion, dto: ExportarSimpatizantesDto): Promise<{ buffer: Buffer; cantidad: number }> {
    const filas = await this.database.comoUsuario(usuario.id, async (trx) => {
      const territoriosDescendientes =
        dto.territorioId !== undefined ? await this.repo.descendientesDe(trx, dto.territorioId) : undefined;

      const encontradas = await this.repo.paraExportar(trx, {
        municipioId: dto.municipioId,
        territoriosDescendientes,
        estado: dto.estado,
        texto: dto.texto?.trim(),
      });

      const territorios = [...new Set(encontradas.map((f) => f.municipio_id).filter((id): id is number => id !== null))];
      await this.repo.registrarExportacion(trx, {
        motivo: dto.motivo.trim(),
        formato: 'XLSX',
        cantidad: encontradas.length,
        territorios,
      });
      return encontradas;
    });

    return { buffer: await construirLibroSimpatizantes(filas), cantidad: filas.length };
  }

  private async linkPrincipal(usuarioId: string): Promise<string> {
    const link = await this.database.comoUsuario(usuarioId, (trx) => this.repo.linkPrincipalDeUsuario(trx, usuarioId));
    if (!link) throw new ReglaNegocioError('Elija el líder que refiere a la persona');
    return link.codigo;
  }

  /** Hora de captura de un registro hecho sin conexión: no puede ser futura
   * (se toleran 5 minutos de desfase del reloj del celular) ni de hace más de
   * 30 días. Sin valor, el registro es de ahora. */
  private validarCaptura(valor: string | undefined): Date | null {
    if (!valor) return null;
    const fecha = new Date(valor);
    const ahora = Date.now();
    if (Number.isNaN(fecha.getTime())) throw new ReglaNegocioError('La hora de captura no es válida');
    if (fecha.getTime() > ahora + 5 * 60_000) throw new ReglaNegocioError('La hora de captura está en el futuro: revise la hora del celular');
    if (fecha.getTime() < ahora - DIAS_MAXIMOS_SIN_CONEXION * 86_400_000) {
      throw new ReglaNegocioError(`El registro se capturó hace más de ${DIAS_MAXIMOS_SIN_CONEXION} días y ya no se puede enviar`);
    }
    // Menos de 5 minutos de diferencia: es un registro en línea normal.
    return ahora - fecha.getTime() < 5 * 60_000 ? null : fecha;
  }

  /** Un usuario solo puede atribuir el registro a un líder de su alcance
   * (su propia red o su territorio): no a cualquier código que conozca. */
  private async linkPermitido(usuario: UsuarioSesion, codigo: string): Promise<string> {
    const normalizado = codigo.trim().toUpperCase();
    const lideres = await this.lideresParaRegistro(usuario);
    if (!lideres.some((l) => l.codigo_link === normalizado)) {
      throw new ReglaNegocioError('El líder elegido no está dentro de su alcance');
    }
    return normalizado;
  }

  private async registrar(
    dto: RegistroSimpatizanteDto,
    codigoLink: string | undefined,
    canal: string,
    usuarioId: string | null,
    ip: string | null,
    userAgent: string | null,
    devolverId: boolean,
    capturadoEn: Date | null = null,
  ) {
    if (!codigoLink) throw new ReglaNegocioError('El código de referido es obligatorio');
    if (dto.aceptaPolitica !== true || !dto.finalidades.includes('ORGANIZACION_CAMPANA')) {
      throw new ReglaNegocioError('Debe aceptar la política y la finalidad de organización de campaña');
    }
    if ((dto.lon === undefined) !== (dto.lat === undefined)) {
      throw new ReglaNegocioError('La geolocalización debe incluir longitud y latitud');
    }

    const documento = this.cifrado.normalizarNumero(dto.documento);
    const telefono = dto.telefono ? this.cifrado.normalizarNumero(dto.telefono) : null;
    const jornada = await this.database.comoUsuario(usuarioId, (trx) => this.repo.jornadaMasReciente(trx));

    const resultado = await this.database.comoUsuario(usuarioId, (trx) =>
      this.repo.registrar(trx, {
        documentoHash: this.cifrado.hash(documento),
        documentoCifrado: this.cifrado.cifrar(documento),
        nombres: dto.nombres.trim(),
        apellidos: dto.apellidos.trim(),
        telefonoHash: telefono ? this.cifrado.hash(telefono) : null,
        telefonoCifrado: telefono ? this.cifrado.cifrar(telefono) : null,
        territorioId: dto.territorioId,
        codigoLink,
        canal,
        politicaVersion: dto.politicaVersion,
        finalidades: dto.finalidades,
        aceptacionTexto: capturadoEn
          ? `Aceptó la política v${dto.politicaVersion} en ${canal}, capturado sin conexión el ${capturadoEn.toISOString()} (hora del dispositivo)`
          : `Aceptó la política v${dto.politicaVersion} en ${canal}`,
        jornadaId: jornada?.id ?? null,
        puestoId: dto.puestoId ?? null,
        necesidad: dto.necesidad?.trim() || null,
        categoria: dto.categoria?.trim() || null,
        lon: dto.lon ?? null,
        lat: dto.lat ?? null,
        ip,
        userAgent: userAgent?.slice(0, 300) ?? null,
        capturadoEn,
      }),
    );

    if (resultado.resultado === 'DUPLICADO') {
      if (!devolverId) return { resultado: 'RECIBIDO', mensaje: 'Gracias, tu registro fue recibido' };
      throw new ConflictoError('La persona ya está registrada');
    }
    if (resultado.resultado === 'LINK_INVALIDO') throw new ReglaNegocioError('El código de referido no es válido');
    if (!devolverId && resultado.resultado === 'REGISTRADO') {
      return { resultado: 'RECIBIDO', mensaje: 'Gracias, tu registro fue recibido' };
    }
    return devolverId
      ? { resultado: resultado.resultado, persona_id: resultado.persona_id, mensaje: resultado.mensaje }
      : { resultado: resultado.resultado, mensaje: resultado.mensaje };
  }
}
