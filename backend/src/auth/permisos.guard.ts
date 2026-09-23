import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { sql } from 'kysely';
import { DatabaseService } from '../database/database.service.js';
import { PERMISOS_REQUERIDOS } from './decoradores.js';

/** Guard global: si la ruta tiene @RequierePermiso(...), lo verifica en la base. */
@Injectable()
export class PermisosGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly database: DatabaseService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const requeridos = this.reflector.getAllAndOverride<string[]>(PERMISOS_REQUERIDOS, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!requeridos || requeridos.length === 0) return true;

    const usuario = ctx.switchToHttp().getRequest<Request>().usuario;
    if (!usuario) throw new ForbiddenException();

    const { rows } = await sql<{ permiso_codigo: string }>`
      select permiso_codigo from acceso.permisos_de(${usuario.id}::uuid)
    `.execute(this.database.db);
    const tiene = new Set(rows.map((r) => r.permiso_codigo));

    if (!requeridos.every((p) => tiene.has(p))) {
      throw new ForbiddenException('No tiene permiso para esta acción');
    }
    return true;
  }
}
