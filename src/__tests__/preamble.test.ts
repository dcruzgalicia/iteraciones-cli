import { beforeAll, describe, expect, it } from 'bun:test';

// ─── 05-bibliography-heading ────────────────────────────────────────────────

describe('05-bibliography-heading (preamble transpiler)', () => {
  let mod: any;

  beforeAll(async () => {
    mod = await import('../builder/preamble/05-bibliography-heading.ts');
  });

  it('exporta una función process', () => {
    expect(typeof mod.process).toBe('function');
  });

  it('emite defbibheading condicionado a que biblatex esté cargado', () => {
    const preamble: string[] = [];
    mod.process(preamble, {});
    const joined = preamble.join('\n');
    expect(joined).toContain('\\ifcsname ver@biblatex.sty\\endcsname');
    expect(joined).toContain('\\defbibheading{bibintoc}[\\refname]{%');
    expect(joined).toContain('\\fi');
    // El defbibheading solo puede ejecutarse dentro del condicional
    const ifIdx = joined.indexOf('\\ifcsname');
    const defIdx = joined.indexOf('\\defbibheading');
    const fiIdx = joined.lastIndexOf('\\fi');
    expect(ifIdx).toBeGreaterThan(-1);
    expect(defIdx).toBeGreaterThan(ifIdx);
    expect(defIdx).toBeLessThan(fiIdx);
  });
});
