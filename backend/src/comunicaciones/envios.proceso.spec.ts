import type { Transaction } from 'kysely';
import { CifradoService } from '../cifrado/cifrado.service.js';
import type { DatabaseService } from '../database/database.service.js';
import type { DB } from '../database/db.types.js';
import { crearTokenBaja, leerTokenBaja } from './enlace-baja.js';
import { EnviosProceso } from './envios.proceso.js';
import { EnvioFallidoError } from './proveedores.service.js';

const cifrado = new CifradoService({
  get: (k: string) => ({ PEPPER_HMAC: Buffer.alloc(32, 1).toString('base64'), LLAVE_CIFRADO: Buffer.alloc(32, 2).toString('base64') })[k],
} as never);
const PERSONA = '13c3e8eb-e9d6-4d96-8579-720887ce85d2';

describe('Enlace de baja', () => {
  it('ida y vuelta: identifica persona y canal', () => {
    const token = crearTokenBaja(cifrado, PERSONA, 'SMS');
    expect(token.length).toBeLessThan(45);
    expect(leerTokenBaja(cifrado, token)).toEqual({ personaId: PERSONA, canal: 'SMS' });
  });

  it('no se puede cambiar la persona ni el canal sin romper la firma', () => {
    const b = Buffer.from(crearTokenBaja(cifrado, PERSONA, 'SMS'), 'base64url');
    const otroCanal = Buffer.from(b);
    otroCanal[16] = 1;
    const otraPersona = Buffer.from(b);
    otraPersona[0] ^= 1;
    expect(leerTokenBaja(cifrado, otroCanal.toString('base64url'))).toBeNull();
    expect(leerTokenBaja(cifrado, otraPersona.toString('base64url'))).toBeNull();
    expect(leerTokenBaja(cifrado, 'basura')).toBeNull();
  });
});

describe('EnviosProceso', () => {
  const trx = {} as Transaction<DB>;
  const database = { comoUsuario: vi.fn(async (_id: string | null, fn: (t: Transaction<DB>) => unknown) => fn(trx)) };
  const proveedores = { sms: vi.fn(async () => undefined), correo: vi.fn(async () => undefined), telegram: vi.fn(async () => undefined) };
  const repo = {
    enviosListos: vi.fn(),
    lote: vi.fn(),
    marcarDestinatario: vi.fn(async () => undefined),
    cerrarEnvio: vi.fn(async () => true),
  };
  const proceso = new EnviosProceso(database as unknown as DatabaseService, cifrado, proveedores as never, repo as never, {
    getOrThrow: () => 'https://app.campana.co/r',
  } as never);

  beforeEach(() => vi.clearAllMocks());

  it('corre sin usuario, personaliza, agrega la baja y marca cada destinatario', async () => {
    repo.enviosListos.mockResolvedValueOnce([{ id: 'e1', canal: 'SMS', contenido: 'Hola {nombre}, te esperamos', asunto: null }]);
    repo.lote
      .mockResolvedValueOnce([
        { persona_id: PERSONA, nombre: 'Ana', telefono_cifrado: cifrado.cifrar('3101234567'), correo: null },
        { persona_id: '22222222-2222-2222-2222-222222222222', nombre: 'Luis', telefono_cifrado: null, correo: null },
      ])
      .mockResolvedValueOnce([]);

    await expect(proceso.procesar()).resolves.toBe(2);

    expect(database.comoUsuario.mock.calls.every(([id]) => id === null)).toBe(true);
    const [celular, texto] = proveedores.sms.mock.calls[0] as unknown as [string, string];
    expect(celular).toBe('3101234567');
    expect(texto).toMatch(/^Hola Ana, te esperamos No mas mensajes: https:\/\/app\.campana\.co\/baja\/[\w-]+$/);
    expect(repo.marcarDestinatario).toHaveBeenCalledWith(trx, 'e1', PERSONA, 'ENVIADO', null);
    expect(repo.marcarDestinatario).toHaveBeenCalledWith(trx, 'e1', '22222222-2222-2222-2222-222222222222', 'FALLIDO', 'Sin celular');
    expect(repo.cerrarEnvio).toHaveBeenCalledWith(trx, 'e1');
  });

  it('si el proveedor falla, el destinatario queda FALLIDO y sigue con los demás', async () => {
    repo.enviosListos.mockResolvedValueOnce([{ id: 'e2', canal: 'EMAIL', contenido: 'Noticias', asunto: 'Boletín' }]);
    repo.lote.mockResolvedValueOnce([{ persona_id: PERSONA, nombre: 'Ana', telefono_cifrado: null, correo: 'ana@correo.co' }]).mockResolvedValueOnce([]);
    proveedores.correo.mockRejectedValueOnce(new EnvioFallidoError('Resend respondió 429'));
    await proceso.procesar();
    expect(repo.marcarDestinatario).toHaveBeenCalledWith(trx, 'e2', PERSONA, 'FALLIDO', 'Resend respondió 429');
  });

  it('Telegram publica una vez en el canal, sin datos de nadie', async () => {
    repo.enviosListos.mockResolvedValueOnce([{ id: 'e3', canal: 'TELEGRAM', contenido: 'Hola {nombre}: foro el sábado', asunto: null }]);
    await proceso.procesar();
    expect(proveedores.telegram).toHaveBeenCalledWith('Hola : foro el sábado');
    expect(repo.lote).not.toHaveBeenCalled();
    expect(repo.cerrarEnvio).toHaveBeenCalledWith(trx, 'e3', 'Publicado en el canal de Telegram');
  });
});
