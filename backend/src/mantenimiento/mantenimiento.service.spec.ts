import { Logger } from '@nestjs/common';
import type { DatabaseService } from '../database/database.service.js';
import { MantenimientoService } from './mantenimiento.service.js';

/**
 * Las dos tareas están decoradas con @Cron: nadie espera su promesa, así que
 * una excepción que escape se convierte en una unhandled rejection que puede
 * tumbar el proceso. Por eso lo que se prueba aquí es que NUNCA propagan.
 */

/** Ejecutor mínimo de Kysely: suficiente para que `sql\`...\`.execute(db)` corra
 * sin base de datos y devuelva (o rechace) lo que diga la prueba. */
function dbFalso(respuesta: { rows: unknown[] } | Error) {
  const ejecutor = {
    transformQuery: (nodo: unknown) => nodo,
    compileQuery: () => ({ sql: '', parameters: [], query: null }),
    executeQuery: async () => {
      if (respuesta instanceof Error) throw respuesta;
      return respuesta;
    },
  };
  return { db: { getExecutor: () => ejecutor } } as unknown as DatabaseService;
}

describe('MantenimientoService', () => {
  let errores: ReturnType<typeof vi.spyOn>;
  let registros: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errores = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    registros = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('refrescarConteos()', () => {
    it('no propaga la excepción si la consulta falla y deja constancia en el log', async () => {
      const servicio = new MantenimientoService(dbFalso(new Error('conexión rechazada')));

      await expect(servicio.refrescarConteos()).resolves.toBeUndefined();
      expect(errores).toHaveBeenCalledTimes(1);
      expect(errores.mock.calls[0][0]).toContain('No se pudieron refrescar los conteos');
    });

    it('no registra errores cuando la consulta funciona', async () => {
      const servicio = new MantenimientoService(dbFalso({ rows: [] }));

      await expect(servicio.refrescarConteos()).resolves.toBeUndefined();
      expect(errores).not.toHaveBeenCalled();
    });
  });

  describe('purgarMensajes()', () => {
    it('no propaga la excepción si la consulta falla y deja constancia en el log', async () => {
      const servicio = new MantenimientoService(dbFalso(new Error('conexión rechazada')));

      await expect(servicio.purgarMensajes()).resolves.toBeUndefined();
      expect(errores).toHaveBeenCalledTimes(1);
      expect(errores.mock.calls[0][0]).toContain('No se pudo purgar los mensajes');
    });

    it('registra cuántos mensajes se purgaron', async () => {
      const servicio = new MantenimientoService(dbFalso({ rows: [{ purgar_mensajes: 25 }] }));

      await servicio.purgarMensajes();

      expect(errores).not.toHaveBeenCalled();
      expect(registros.mock.calls[0][0]).toContain('25');
    });

    it('registra cero cuando la función no devuelve filas', async () => {
      const servicio = new MantenimientoService(dbFalso({ rows: [] }));

      await servicio.purgarMensajes();

      expect(registros.mock.calls[0][0]).toContain('0');
    });
  });
});
