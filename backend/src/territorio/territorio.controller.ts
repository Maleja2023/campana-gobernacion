import { BadRequestException, Controller, Get, ParseIntPipe, Query } from '@nestjs/common';
import { Publico, RequierePermiso, UsuarioActual } from '../auth/decoradores.js';
import type { UsuarioSesion } from '../auth/auth.types.js';
import { TerritorioService } from './territorio.service.js';

const TIPOS_VALIDOS = ['MUNICIPIO', 'COMUNA', 'CORREGIMIENTO', 'BARRIO', 'VEREDA', 'CENTRO_POBLADO'];

@Controller('territorio')
export class TerritorioController {
  constructor(private readonly territorio: TerritorioService) {}

  /**
   * GET /api/territorio/buscar?q=porvenir&tipo=VEREDA
   * Público: lo usa el formulario de registro. Solo devuelve datos del DANE.
   */
  @Publico()
  @Get('buscar')
  buscar(
    @Query('q') q?: string,
    @Query('tipo') tipo?: string,
    @Query('padre', new ParseIntPipe({ optional: true })) padre?: number,
  ) {
    const texto = (q ?? '').trim();
    if (texto.length < 3 || texto.length > 80) {
      throw new BadRequestException('Escriba entre 3 y 80 caracteres');
    }
    if (tipo !== undefined && !TIPOS_VALIDOS.includes(tipo)) {
      throw new BadRequestException(`Tipo inválido. Use: ${TIPOS_VALIDOS.join(', ')}`);
    }
    return this.territorio.buscar(texto, tipo, padre);
  }

  @Publico()
  @Get('municipios')
  municipios() {
    return this.territorio.municipios();
  }

  @Publico()
  @Get('puestos')
  puestos(@Query('municipioId', ParseIntPipe) municipioId: number) {
    return this.territorio.puestos(municipioId);
  }

  @Publico()
  @Get('contorno')
  contorno() {
    return this.territorio.contorno();
  }

  /**
   * GET /api/territorio/mapa            -> municipios del departamento
   * GET /api/territorio/mapa?padre=2    -> subdivisiones de ese territorio
   *
   * Requiere login y el permiso MAPA_VER: los conteos de simpatizantes son
   * información estratégica de la campaña.
   */
  @RequierePermiso('MAPA_VER')
  @Get('mapa')
  mapa(@UsuarioActual() usuario: UsuarioSesion, @Query('padre', new ParseIntPipe({ optional: true })) padre?: number) {
    return this.territorio.mapa(usuario, padre);
  }
}
