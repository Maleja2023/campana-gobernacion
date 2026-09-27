import { anonimizar, clasificarPorReglas } from './categorias.js';

describe('clasificarPorReglas', () => {
  it.each([
    ['La vía a la vereda está llena de huecos', 'VIAS'],
    ['No hay señal de internet', 'CONECTIVIDAD'],
    ['Falta puesto de salud y médico', 'SALUD'],
    ['Inseguridad en la noche, muchos robos', 'SEGURIDAD'],
    ['No hay empleo para jóvenes', 'EMPLEO'],
    ['Necesitamos acueducto, el agua no es potable', 'AGUA'],
  ])('"%s" -> %s', (texto, esperada) => {
    expect(clasificarPorReglas(texto).categoria).toBe(esperada);
  });

  it('sin palabras conocidas queda en OTRA con confianza baja', () => {
    expect(clasificarPorReglas('Queremos un parque para los niños')).toEqual({ categoria: 'OTRA', confianza: 0.2 });
  });
});

describe('anonimizar', () => {
  it('borra cédulas, teléfonos y correos', () => {
    expect(anonimizar('Llamar a Juan al 310 555 1234, cédula 1.117.456.789, juan@correo.com')).toBe(
      'Llamar a Juan al [número], cédula [número], [correo]',
    );
  });
});
