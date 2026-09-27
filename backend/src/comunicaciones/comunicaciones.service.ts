import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { UsuarioSesion } from '../auth/auth.types.js';
import { CifradoService } from '../cifrado/cifrado.service.js';
import { NoEncontradoError, ReglaNegocioError } from '../comun/errores/errores-dominio.js';
import { DatabaseService } from '../database/database.service.js';
import { ComunicacionesRepositorio } from './comunicaciones.repositorio.js';
import type { AvisoEquipoDto, EnvioDto, PlantillaDto } from './dto/comunicaciones.dto.js';
import { leerTokenBaja } from './enlace-baja.js';
import { ProveedoresService } from './proveedores.service.js';

const NOMBRES_CANAL = { SMS: 'mensajes de texto (SMS)', EMAIL: 'correos', TELEGRAM: 'mensajes de Telegram' } as const;
/** Un SMS de más de 160 caracteres se cobra como varios. El enlace de baja ocupa ~70. */
export const LARGO_SMS = 230;

@Injectable()
export class ComunicacionesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly cifrado: CifradoService,
    private readonly proveedores: ProveedoresService,
    private readonly repo: ComunicacionesRepositorio,
    private readonly config: ConfigService,
  ) {}

  notificaciones(u: UsuarioSesion) {
    return this.database.comoUsuario(u.id, (trx) => this.repo.notificaciones(trx, 50));
  }

  async marcarLeidas(u: UsuarioSesion, ids?: string[]) {
    await this.database.comoUsuario(u.id, (trx) => this.repo.marcarLeidas(trx, ids?.length ? ids : null));
    return { ok: true };
  }

  async avisoEquipo(u: UsuarioSesion, dto: AvisoEquipoDto) {
    const enviados = await this.database.comoUsuario(u.id, (trx) =>
      this.repo.avisoEquipo(trx, dto.titulo.trim(), dto.cuerpo.trim(), dto.cargos?.length ? dto.cargos : null),
    );
    return { enviados };
  }

  configuracion() {
    return { canales: this.proveedores.disponibles(), largoSms: LARGO_SMS };
  }

  plantillas(u: UsuarioSesion) {
    return this.database.comoUsuario(u.id, (trx) => this.repo.plantillas(trx));
  }

  async crearPlantilla(u: UsuarioSesion, dto: PlantillaDto) {
    if (dto.canal === 'SMS' && dto.contenido.length > LARGO_SMS) {
      throw new ReglaNegocioError(`Un SMS puede tener hasta ${LARGO_SMS} caracteres (el enlace para darse de baja se agrega solo)`);
    }
    if (dto.canal === 'TELEGRAM' && dto.contenido.includes('{nombre}')) {
      throw new ReglaNegocioError('En Telegram el mensaje va al canal público: no uses {nombre}');
    }
    if (dto.canal === 'EMAIL' && !dto.asunto) throw new ReglaNegocioError('El correo necesita un asunto');
    const id = await this.database.comoUsuario(u.id, (trx) =>
      this.repo.crearPlantilla(trx, u.id, { nombre: dto.nombre.trim(), canal: dto.canal, asunto: dto.asunto?.trim() ?? null, contenido: dto.contenido.trim() }),
    );
    return { id };
  }

  async editarPlantilla(u: UsuarioSesion, id: string, asunto: string | undefined, contenido: string) {
    const filas = await this.database.comoUsuario(u.id, (trx) => this.repo.editarPlantilla(trx, id, asunto?.trim() ?? null, contenido.trim()));
    if (!filas) throw new NoEncontradoError('Plantilla no encontrada');
    return { id, mensaje: 'Plantilla actualizada. Necesita aprobarse otra vez.' };
  }

  async aprobarPlantilla(u: UsuarioSesion, id: string) {
    await this.database.comoUsuario(u.id, (trx) => this.repo.aprobarPlantilla(trx, id));
    return { id };
  }

  envios(u: UsuarioSesion) {
    return this.database.comoUsuario(u.id, (trx) => this.repo.envios(trx));
  }

  async prepararEnvio(u: UsuarioSesion, dto: EnvioDto) {
    const id = await this.database.comoUsuario(u.id, (trx) => this.repo.prepararEnvio(trx, dto.plantillaId, dto.territorioIds, dto.programadoPara ?? null));
    return { id };
  }

  async cambiarEstadoEnvio(u: UsuarioSesion, id: string, estado: string) {
    await this.database.comoUsuario(u.id, (trx) => this.repo.cambiarEstadoEnvio(trx, id, estado));
    return { id, estado };
  }

  // Baja por enlace (público) ------------------------------------------------

  consultarBaja(token: string) {
    const datos = leerTokenBaja(this.cifrado, token);
    if (!datos) throw new NoEncontradoError('Este enlace no es válido. Si quieres dejar de recibir mensajes, usa la página Mis datos.');
    return { canal: datos.canal, descripcion: NOMBRES_CANAL[datos.canal] };
  }

  async darDeBaja(token: string) {
    const datos = leerTokenBaja(this.cifrado, token);
    if (!datos) throw new NoEncontradoError('Este enlace no es válido. Si quieres dejar de recibir mensajes, usa la página Mis datos.');
    await this.database.comoUsuario(null, (trx) => this.repo.darDeBaja(trx, datos.personaId, datos.canal));
    return { mensaje: `Listo. No te enviaremos más ${NOMBRES_CANAL[datos.canal]}.` };
  }
}
