import 'reflect-metadata';
import { validarVariablesEntorno } from './variables-entorno.js';

const CLAVE = Buffer.alloc(32, 7).toString('base64');
const base = {
  CORS_ORIGENES: 'http://localhost:5173',
  URL_REGISTRO_BASE: 'http://localhost:5173/r',
  DB_HOST: 'localhost',
  DB_NOMBRE: 'campana',
  DB_USUARIO: 'api_campana',
  DB_CLAVE: 'clave-larga-de-prueba',
  JWT_SECRETO: 'x'.repeat(40),
  COOKIE_SEGURA: 'false',
  PEPPER_HMAC: CLAVE,
  LLAVE_CIFRADO: CLAVE,
};

describe('validarVariablesEntorno: captcha', () => {
  it('en desarrollo el captcha es opcional, y las claves vacías cuentan como no configuradas', () => {
    expect(() => validarVariablesEntorno({ ...base, TURNSTILE_SECRETO: '', TURNSTILE_SITEKEY: '' })).not.toThrow();
  });

  it('en producción (COOKIE_SEGURA=true) exige TURNSTILE_SECRETO', () => {
    expect(() => validarVariablesEntorno({ ...base, COOKIE_SEGURA: 'true' })).toThrow(/TURNSTILE_SECRETO/);
  });

  it('exige las dos claves juntas', () => {
    expect(() => validarVariablesEntorno({ ...base, TURNSTILE_SECRETO: '1x0000000000000000000000000000000AA' })).toThrow(/TURNSTILE_SITEKEY/);
    expect(() =>
      validarVariablesEntorno({
        ...base,
        COOKIE_SEGURA: 'true',
        TURNSTILE_SECRETO: '1x0000000000000000000000000000000AA',
        TURNSTILE_SITEKEY: '1x00000000000000000000AA',
      }),
    ).not.toThrow();
  });
});
