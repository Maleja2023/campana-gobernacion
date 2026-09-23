import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { sql } from 'kysely';
import { CifradoService } from '../cifrado/cifrado.service.js';
import { DatabaseService } from '../database/database.service.js';
import type { UsuarioSesion } from '../auth/auth.types.js';
import type { RegistroSimpatizanteDto } from './dto/registro-simpatizante.dto.js';

interface ResultadoRegistro {
  resultado: string;
  persona_id: string | null;
  mensaje: string;
}

export interface Politica {
  version: number;
  texto: string;
  finalidades: { codigo: string; descripcion: string }[];
}

@Injectable()
export class SimpatizantesService {
  private readonly logger = new Logger(SimpatizantesService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly cifrado: CifradoService,
  ) {}

  async politica(): Promise<Politica> {
    return this.database.comoUsuario(null, async (trx) => {
      const politica = await trx
        .selectFrom('cumplimiento.politicas_tratamiento')
        .select(['version', 'texto'])
        .where('vigente_hasta', 'is', null)
        .orderBy('version', 'desc')
        .executeTakeFirst();
      if (!politica) throw new NotFoundException('No hay una política vigente');

      const finalidades = await trx
        .selectFrom('cumplimiento.politica_finalidades as pf')
        .innerJoin('cumplimiento.finalidades as f', 'f.codigo', 'pf.finalidad_codigo')
        .select(['f.codigo', 'f.descripcion'])
        .where('pf.politica_version', '=', politica.version)
        .orderBy('f.codigo')
        .execute();
      return { ...politica, finalidades };
    });
  }

  async autorregistro(dto: RegistroSimpatizanteDto, ip: string | null, userAgent: string | null) {
    return this.registrar(dto, dto.codigoLink, dto.canal, null, ip, userAgent, false);
  }

  async crear(dto: RegistroSimpatizanteDto, usuario: UsuarioSesion, ip: string | null, userAgent: string | null) {
    const codigo = dto.codigoLink ?? (await this.linkPrincipal(usuario.id));
    return this.registrar(dto, codigo, 'DIGITADOR', usuario.id, ip, userAgent, true);
  }

  async listar(usuario: UsuarioSesion, filtros: { municipioId?: number; territorioId?: number; estado?: string; texto?: string; pagina: number; porPagina: number }) {
    return this.database.comoUsuario(usuario.id, async (trx) => {
      let consulta = trx.selectFrom('campana.v_simpatizantes').selectAll();
      let conteo = trx.selectFrom('campana.v_simpatizantes').select(({ fn }) => fn.countAll<number>().as('total'));
      if (filtros.municipioId !== undefined) {
        consulta = consulta.where('municipio_id', '=', filtros.municipioId);
        conteo = conteo.where('municipio_id', '=', filtros.municipioId);
      }
      if (filtros.territorioId !== undefined) {
        consulta = consulta.where('territorio_residencia_id', '=', filtros.territorioId);
        conteo = conteo.where('territorio_residencia_id', '=', filtros.territorioId);
      }
      if (filtros.estado !== undefined) {
        consulta = consulta.where('estado_codigo', '=', filtros.estado);
        conteo = conteo.where('estado_codigo', '=', filtros.estado);
      }
      if (filtros.texto) {
        const patron = `%${filtros.texto}%`;
        consulta = consulta.where((eb) => eb.or([eb('nombres', 'ilike', patron), eb('apellidos', 'ilike', patron)]));
        conteo = conteo.where((eb) => eb.or([eb('nombres', 'ilike', patron), eb('apellidos', 'ilike', patron)]));
      }
      const [datos, total] = await Promise.all([
        consulta.orderBy('capturado_en', 'desc').limit(filtros.porPagina).offset((filtros.pagina - 1) * filtros.porPagina).execute(),
        conteo.executeTakeFirstOrThrow(),
      ]);
      return { datos, total: Number(total.total), pagina: filtros.pagina, porPagina: filtros.porPagina };
    });
  }

  async documento(usuario: UsuarioSesion, personaId: string) {
    return this.database.comoUsuario(usuario.id, async (trx) => {
      let persona: { documento_cifrado: Buffer } | undefined;
      try {
        persona = await trx
          .selectFrom('personas.personas')
          .select('documento_cifrado')
          .where('id', '=', personaId)
          .executeTakeFirst();
      } finally {
        await sql`select auditoria.registrar_consulta('personas', 'personas', ${personaId})`.execute(trx);
      }
      if (!persona) throw new NotFoundException('Registro no encontrado');
      return { documento: this.cifrado.descifrar(persona.documento_cifrado) };
    });
  }

  private async linkPrincipal(usuarioId: string): Promise<string> {
    const link = await this.database.comoUsuario(usuarioId, (trx) =>
      trx
        .selectFrom('acceso.usuarios as u')
        .innerJoin('campana.miembros as m', 'm.persona_id', 'u.persona_id')
        .innerJoin('campana.links_referido as l', 'l.miembro_id', 'm.id')
        .select('l.codigo')
        .where('u.id', '=', usuarioId)
        .where('l.es_principal', '=', true)
        .where('l.activo', '=', true)
        .executeTakeFirst(),
    );
    if (!link) throw new BadRequestException('No existe un link de referido activo');
    return link.codigo;
  }

  private async registrar(
    dto: RegistroSimpatizanteDto,
    codigoLink: string | undefined,
    canal: string,
    usuarioId: string | null,
    ip: string | null,
    userAgent: string | null,
    devolverId: boolean,
  ) {
    if (!codigoLink) throw new BadRequestException('El código de referido es obligatorio');
    if (dto.aceptaPolitica !== true || !dto.finalidades.includes('ORGANIZACION_CAMPANA')) {
      throw new BadRequestException('Debe aceptar la política y la finalidad de organización de campaña');
    }
    if ((dto.lon === undefined) !== (dto.lat === undefined)) {
      throw new BadRequestException('La geolocalización debe incluir longitud y latitud');
    }

    const documento = this.cifrado.normalizarNumero(dto.documento);
    const telefono = dto.telefono ? this.cifrado.normalizarNumero(dto.telefono) : null;
    const jornada = await this.database.comoUsuario(usuarioId, (trx) =>
      trx.selectFrom('electoral.jornadas').select('id').orderBy('fecha', 'desc').executeTakeFirst(),
    );

    try {
      const resultado = await this.database.comoUsuario(usuarioId, async (trx) => {
        const { rows } = await sql<ResultadoRegistro>`
          select * from campana.registrar_simpatizante(
            'CC', ${this.cifrado.hash(documento)}, ${this.cifrado.cifrar(documento)},
            ${dto.nombres.trim()}, ${dto.apellidos.trim()},
            ${telefono ? this.cifrado.hash(telefono) : null}, ${telefono ? this.cifrado.cifrar(telefono) : null},
            ${dto.territorioId}, ${codigoLink}, ${canal}, ${dto.politicaVersion}::smallint,
            ${sql.val(dto.finalidades)}::text[], ${'Aceptó la política v' + dto.politicaVersion + ' en ' + canal}, now(),
            ${jornada?.id ?? null}::smallint, ${dto.puestoId ?? null}::integer,
            ${dto.necesidad?.trim() || null}, ${dto.categoria?.trim() || null},
            ${dto.lon ?? null}::double precision, ${dto.lat ?? null}::double precision,
            ${ip}::inet, ${userAgent?.slice(0, 300) ?? null}
          )
        `.execute(trx);
        return rows[0];
      });
      if (resultado.resultado === 'DUPLICADO') {
        if (!devolverId) {
          return { resultado: 'RECIBIDO', mensaje: 'Gracias, tu registro fue recibido' };
        }
        throw new ConflictException('La persona ya está registrada');
      }
      if (resultado.resultado === 'LINK_INVALIDO') throw new BadRequestException('El código de referido no es válido');
      if (!devolverId && resultado.resultado === 'REGISTRADO') {
        return { resultado: 'RECIBIDO', mensaje: 'Gracias, tu registro fue recibido' };
      }
      return devolverId
        ? { resultado: resultado.resultado, persona_id: resultado.persona_id, mensaje: resultado.mensaje }
        : { resultado: resultado.resultado, mensaje: resultado.mensaje };
    } catch (error: unknown) {
      if (error instanceof ConflictException || error instanceof BadRequestException) throw error;
      const detalle = error as { code?: string; name?: string };
      this.logger.error(`No se pudo registrar simpatizante (${detalle.code ?? detalle.name ?? 'error'})`);
      throw new BadRequestException('No fue posible completar el registro');
    }
  }
}