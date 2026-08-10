import { describe, expect, it } from 'bun:test';
import { formatUserError } from '../lib/errors.js';

describe('formatUserError', () => {
  it('elimina prefijos de clase conocidos', () => {
    expect(formatUserError(new SyntaxError('yaml: línea inválida'))).toBe('yaml: línea inválida');
    expect(formatUserError(new TypeError('valor no esperado'))).toBe('valor no esperado');
    expect(formatUserError(new Error('algo falló'))).toBe('algo falló');
  });

  it('elimina prefijos de clases del proyecto', () => {
    expect(formatUserError(new Error('BuildError: build falló'))).toBe('build falló');
    expect(formatUserError(new Error('ConfigError: config inválida'))).toBe('config inválida');
  });

  it('no trunca "Error" en medio del mensaje', () => {
    const msg = 'Error en línea 5: token inesperado';
    expect(formatUserError(new Error(msg))).toBe('Error en línea 5: token inesperado');
  });

  it('conserva el mensaje completo sin prefijo', () => {
    const msg = 'documento sin frontmatter válido';
    expect(formatUserError(new Error(msg))).toBe(msg);
  });

  it('retorna String(err) para valores no-Error', () => {
    expect(formatUserError('texto plano')).toBe('texto plano');
    expect(formatUserError(42)).toBe('42');
  });
});
