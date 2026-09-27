import { BadRequestException, Controller, Get, ParseIntPipe, Query } from '@nestjs/common';
import { Publico, RequierePermiso, UsuarioActual } from '../auth/decoradores.js';
import type { UsuarioSesion } from '../auth/auth.types.js';
import { MapaMunicipioQueryDto, MapaQueryDto, NecesidadesMapaQueryDto } from './dto/mapa-query.dto.js';
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

  /** GET /api/territorio/catalogo-registro — municipios, zonas y puestos para
   * registrar sin conexión. Público: son datos oficiales, sin datos personales. */
  @Publico()
  @Get('catalogo-registro')
  catalogoRegistro() {
    return this.territorio.catalogoRegistro();
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
  mapa(@UsuarioActual() usuario: UsuarioSesion, @Query() q: MapaQueryDto) {
    const { padre, ...filtros } = q;
    return this.territorio.mapa(usuario, padre, filtros);
  }

  /** GET /api/territorio/mapa/calor?municipioId=&miembroId=&desde=&hasta= */
  @RequierePermiso('MAPA_VER')
  @Get('mapa/calor')
  calor(@UsuarioActual() usuario: UsuarioSesion, @Query() q: MapaMunicipioQueryDto) {
    const { municipioId, ...filtros } = q;
    return this.territorio.calor(usuario, municipioId, filtros);
  }

  /** GET /api/territorio/mapa/necesidades?padre=&categoria= */
  @RequierePermiso('MAPA_VER')
  @Get('mapa/necesidades')
  necesidades(@UsuarioActual() usuario: UsuarioSesion, @Query() q: NecesidadesMapaQueryDto) {
    return this.territorio.necesidades(usuario, q.padre, q.categoria);
  }

  /** GET /api/territorio/mapa/brecha?municipioId=&miembroId=&desde=&hasta= */
  @RequierePermiso('MAPA_VER')
  @Get('mapa/brecha')
  brecha(@UsuarioActual() usuario: UsuarioSesion, @Query() q: MapaMunicipioQueryDto) {
    const { municipioId, ...filtros } = q;
    return this.territorio.brecha(usuario, municipioId, filtros);
  }

  /** GET /api/territorio/mapa/miembros: coordinadores y líderes para filtrar. */
  @RequierePermiso('MAPA_VER')
  @Get('mapa/miembros')
  miembros(@UsuarioActual() usuario: UsuarioSesion) {
    return this.territorio.miembrosFiltro(usuario);
  }
}
