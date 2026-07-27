import { describe, expect, it } from 'bun:test';
import { computeActiveFormats, type FormatConfig } from '../config/site-config.js';

describe('computeActiveFormats', () => {
  const empty: FormatConfig = {
    latex: false,
    html: { generate: false },
    pdf: { generate: false },
    epub: { generate: false },
    markdown: { generate: false },
  };

  it('retorna array vacío cuando ningún formato está activo', () => {
    expect(computeActiveFormats(empty)).toEqual([]);
  });

  it('incluye latex cuando es true', () => {
    expect(computeActiveFormats({ ...empty, latex: true })).toEqual(['latex']);
  });

  it('incluye pdf cuando generate: true', () => {
    expect(computeActiveFormats({ ...empty, pdf: { generate: true } })).toEqual(['pdf']);
  });

  it('incluye html cuando generate: true', () => {
    expect(computeActiveFormats({ ...empty, html: { generate: true } })).toEqual(['html']);
  });

  it('incluye epub cuando generate: true', () => {
    expect(computeActiveFormats({ ...empty, epub: { generate: true } })).toEqual(['epub']);
  });

  it('incluye markdown cuando generate: true', () => {
    expect(computeActiveFormats({ ...empty, markdown: { generate: true } })).toEqual(['markdown']);
  });

  it('incluye múltiples formatos activos simultáneamente', () => {
    const cfg: FormatConfig = {
      ...empty,
      latex: true,
      pdf: { generate: true },
      html: { generate: true },
    };
    const active = computeActiveFormats(cfg);
    expect(active).toContain('latex');
    expect(active).toContain('pdf');
    expect(active).toContain('html');
    expect(active).toHaveLength(3);
  });
});
