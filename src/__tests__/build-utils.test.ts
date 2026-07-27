import { describe, expect, it } from 'bun:test';
import { renderTemplate } from '../builder/build-utils.js';

describe('renderTemplate', () => {
  it('reemplaza variables simples con $nombre$', () => {
    const result = renderTemplate('Hola $nombre$', { nombre: 'Mundo' });
    expect(result).toBe('Hola Mundo');
  });

  it('reemplaza múltiples variables', () => {
    const result = renderTemplate('$saludo$ $nombre$', { saludo: 'Hola', nombre: 'Juan' });
    expect(result).toBe('Hola Juan');
  });

  it('deja $sincoincidencia$ si la variable no existe', () => {
    const result = renderTemplate('$var$', {});
    expect(result).toBe('');
  });

  it('procesa $if(nombre)$...$endif$ cuando la variable existe', () => {
    const result = renderTemplate('$if(titulo)$El título es $titulo$$endif$', { titulo: 'Test' });
    expect(result).toBe('El título es Test');
  });

  it('elimina el bloque $if$ cuando la variable no existe', () => {
    const result = renderTemplate('antes $if(desc)$contenido$endif$ después', {});
    expect(result).toBe('antes  después');
  });

  it('elimina el bloque $if$ cuando la variable es empty string', () => {
    const result = renderTemplate('$if(x)$texto$endif$', { x: '' });
    expect(result).toBe('');
  });

  it('anida variables dentro de bloques if', () => {
    const result = renderTemplate('$if(tit)$<$tit$>$endif$', { tit: 'h1' });
    expect(result).toBe('<h1>');
  });

  it('no interfiere entre múltiples bloques if', () => {
    const tpl = '$if(a)$AAA$endif$ $if(b)$BBB$endif$';
    const result = renderTemplate(tpl, { a: '1' });
    expect(result).toBe('AAA ');
  });

  it('soporta guiones en nombres de variables', () => {
    const result = renderTemplate('$site-title$', { 'site-title': 'Mi Sitio' });
    expect(result).toBe('Mi Sitio');
  });
});
