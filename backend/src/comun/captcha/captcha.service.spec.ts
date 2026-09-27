import { ConfigService } from '@nestjs/config';
import { ReglaNegocioError } from '../errores/errores-dominio.js';
import { CaptchaService } from './captcha.service.js';

describe('CaptchaService', () => {
  const conSecreto = () => new CaptchaService(new ConfigService({ TURNSTILE_SECRETO: 'secreto-de-prueba' }));
  const respuesta = (datos: unknown) => ({ json: async () => datos }) as Response;

  afterEach(() => vi.unstubAllGlobals());

  it('no verifica nada cuando no hay clave configurada (desarrollo)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const servicio = new CaptchaService(new ConfigService({}));

    await expect(servicio.verificar(undefined, null)).resolves.toBeUndefined();
    expect(servicio.activo).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('exige el token cuando hay clave', async () => {
    await expect(conSecreto().verificar(undefined, '1.2.3.4')).rejects.toBeInstanceOf(ReglaNegocioError);
  });

  it('acepta cuando Cloudflare responde success: true y le envía clave, token e IP', async () => {
    const fetchMock = vi.fn(async () => respuesta({ success: true }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(conSecreto().verificar('token-ok', '1.2.3.4')).resolves.toBeUndefined();
    const cuerpo = (fetchMock.mock.calls[0] as unknown as [string, { body: URLSearchParams }])[1].body;
    expect(cuerpo.get('secret')).toBe('secreto-de-prueba');
    expect(cuerpo.get('response')).toBe('token-ok');
    expect(cuerpo.get('remoteip')).toBe('1.2.3.4');
  });

  it('rechaza cuando Cloudflare responde success: false', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respuesta({ success: false, 'error-codes': ['invalid-input-response'] })));

    await expect(conSecreto().verificar('token-malo', null)).rejects.toBeInstanceOf(ReglaNegocioError);
  });

  it('rechaza (no deja pasar) si Cloudflare no responde', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('timeout'); }));

    await expect(conSecreto().verificar('token', null)).rejects.toBeInstanceOf(ReglaNegocioError);
  });
});
