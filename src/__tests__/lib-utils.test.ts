import { describe, expect, it } from 'bun:test';
import { assembleExportDocument } from '../builder/export/assemble.js';
import type { BuildDocument } from '../builder/types.js';
import { formatHumanDate } from '../lib/date.js';
import { plural } from '../lib/plural.js';

describe('formatHumanDate', () => {
  it('convierte yyyy-mm-dd a formato legible en español', () => {
    expect(formatHumanDate('2026-04-13')).toBe('13 de abril de 2026');
    expect(formatHumanDate('2026-01-01')).toBe('1 de enero de 2026');
    expect(formatHumanDate('2026-12-31')).toBe('31 de diciembre de 2026');
  });

  it('conserva fechas no ISO sin romperlas', () => {
    expect(formatHumanDate('13/04/2026')).toBe('13/04/2026');
    expect(formatHumanDate('')).toBe('');
    expect(formatHumanDate(undefined)).toBeUndefined();
  });

  it('conserva fechas con mes fuera de rango', () => {
    expect(formatHumanDate('2026-13-01')).toBe('2026-13-01');
  });
});

describe('plural', () => {
  it('singular con 1 y plural por vocal/consonante', () => {
    expect(plural(1, 'error')).toBe('1 error');
    expect(plural(2, 'error')).toBe('2 errores');
    expect(plural(1, 'documento')).toBe('1 documento');
    expect(plural(2, 'documento')).toBe('2 documentos');
  });

  it('acepta forma plural explícita para extranjerismos', () => {
    expect(plural(1, 'filter', 'filters')).toBe('1 filter');
    expect(plural(3, 'filter', 'filters')).toBe('3 filters');
    expect(plural(2, 'lua-filter', 'lua-filters')).toBe('2 lua-filters');
  });
});

describe('assembleExportDocument', () => {
  const doc: BuildDocument = {
    filePath: '/proyecto/test.md',
    relativePath: 'test.md',
    frontmatter: { title: 'Título', date: '2026-08-08', author: ['Ana', 'Luis'] },
  };

  it('ensambla los metadatos efectivos con la fecha legible y el lang', () => {
    const exp = assembleExportDocument(doc, 'es-MX', undefined, undefined, true);
    expect(exp.metadata.title).toBe('Título');
    expect(exp.metadata.date).toBe('8 de agosto de 2026');
    expect(exp.metadata.dateIso).toBe('2026-08-08');
    expect(exp.metadata.lang).toBe('es-MX');
    expect(exp.metadata.toc).toBe(true);
  });

  it('con bibliography global conserva el csl configurado sin fallback al paquete', () => {
    const exp = assembleExportDocument(doc, 'es-MX', '/proyecto/refs.bib', '/proyecto/nature.csl');
    expect(exp.metadata.bibliography).toBe('/proyecto/refs.bib');
    expect(exp.metadata.csl).toBe('/proyecto/nature.csl');
  });

  it('con bibliography global y sin csl no incrusta el apa-7 del paquete (export portable)', () => {
    const exp = assembleExportDocument(doc, 'es-MX', '/proyecto/refs.bib');
    expect(exp.metadata.bibliography).toBe('/proyecto/refs.bib');
    expect(exp.metadata.csl).toBeUndefined();
  });

  it('sin bibliografía global no define csl', () => {
    const exp = assembleExportDocument(doc, 'es-MX');
    expect(exp.metadata.bibliography).toBeUndefined();
    expect(exp.metadata.csl).toBeUndefined();
  });
});
