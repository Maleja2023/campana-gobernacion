import { Injectable } from '@nestjs/common';
import type { UsuarioSesion } from '../auth/auth.types.js';
import { ConflictoError, NoEncontradoError } from '../comun/errores/errores-dominio.js';
import { DatabaseService } from '../database/database.service.js';
import { CalidadRepositorio } from './calidad.repositorio.js';
import type { ResolverAlertaDto } from './dto/resolver-alerta.dto.js';

const ABIERTAS = ['ABIERTA', 'EN_REVISION'];
const CERRADOS = ['RESUELTA', 'DESCARTADA'];

@Injectable()
export class CalidadService {
  constructor(
    private readonly database: DatabaseService,
    private readonly repo: CalidadRepositorio,
  ) {}

  async listar(usuario: UsuarioSesion, estado?: string) {
    return this.database.comoUsuario(usuario.id, (trx) => this.repo.listar(trx, estado ? [estado] : ABIERTAS));
  }

  async detalle(usuario: UsuarioSesion, alertaId: string) {
    return this.database.comoUsuario(usuario.id, async (trx) => {
      if (!(await this.repo.estadoDe(trx, alertaId))) throw new NoEncontradoError('Alerta no encontrada');
      const [personas, miembros] = await Promise.all([this.repo.personasDeAlerta(trx, alertaId), this.repo.miembrosDeAlerta(trx, alertaId)]);
      return { personas, miembros };
    });
  }

  async resolver(usuario: UsuarioSesion, alertaId: string, dto: ResolverAlertaDto) {
    return this.database.comoUsuario(usuario.id, async (trx) => {
      const estado = await this.repo.estadoDe(trx, alertaId);
      if (!estado) throw new NoEncontradoError('Alerta no encontrada');
      // calidad.resolver_alerta no restringe la transición de estado, y el trigger
      // que registra autoría (resuelta_por/resuelta_en) solo dispara la primera vez:
      // sin este chequeo, reabrir el PATCH sobre una alerta ya cerrada cambiaría la
      // observación en silencio sin actualizar quién ni cuándo la cerró.
      if (CERRADOS.includes(estado)) throw new ConflictoError('La alerta ya fue cerrada');
      await this.repo.resolver(trx, alertaId, dto.estado, dto.observacion);
      return { mensaje: 'Alerta actualizada' };
    });
  }
}
