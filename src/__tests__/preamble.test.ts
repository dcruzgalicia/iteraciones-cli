import { describe, expect, it, spyOn } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BUILTIN_PREAMBLE_TRANSPILERS,
  getBuiltinPreambleTranspilerInfos,
  loadPreambleTranspilers,
  validateDisabledPreambleTranspilers,
} from '../builder/preamble-loader.js';
import * as logger from '../lib/logger.js';

describe('preamble-loader', () => {
  it('lista los 6 transpilers built-in con descripción', () => {
    const infos = getBuiltinPreambleTranspilerInfos();
    expect(infos).toHaveLength(6);
    expect(infos.map((i) => i.name)).toEqual(BUILTIN_PREAMBLE_TRANSPILERS);
    expect(infos.every((i) => i.description.length > 0)).toBe(true);
  });

  it('carga el contenido .tex del paquete para todos los transpilers', async () => {
    const transpilers = await loadPreambleTranspilers();
    expect(transpilers).toHaveLength(6);
    const biblio = transpilers.find((t) => t.name === '05-bibliography-heading');
    expect(biblio?.content).toContain('\\ifcsname ver@biblatex.sty\\endcsname');
    expect(biblio?.content).toContain('\\defbibheading{bibintoc}[\\refname]{%');
    const maketitle = transpilers.find((t) => t.name === '01-maketitle-patches');
    expect(maketitle?.content).toContain('\\renewcommand{\\maketitle}{%');
  });

  it('respeta la disabled list', async () => {
    const transpilers = await loadPreambleTranspilers(['06-hyphenation-rules']);
    expect(transpilers.map((t) => t.name)).not.toContain('06-hyphenation-rules');
    expect(transpilers).toHaveLength(5);
  });

  it('un .tex del proyecto reemplaza al del paquete', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'iteraciones-preamble-'));
    try {
      mkdirSync(join(cwd, 'preamble'), { recursive: true });
      writeFileSync(join(cwd, 'preamble', '06-hyphenation-rules.tex'), '% --- Override de proyecto ---\nhyphenation{OverridePrueba}\n');
      const transpilers = await loadPreambleTranspilers(undefined, cwd);
      const hyphen = transpilers.find((t) => t.name === '06-hyphenation-rules');
      expect(hyphen?.content).toContain('OverridePrueba');
      expect(hyphen?.content).not.toContain('Separacion silabica');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe('validateDisabledPreambleTranspilers', () => {
  it('no advierte con undefined o lista vacía', () => {
    const spy = spyOn(logger, 'logWarning');
    validateDisabledPreambleTranspilers(undefined);
    validateDisabledPreambleTranspilers([]);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('no advierte con nombres válidos', () => {
    const spy = spyOn(logger, 'logWarning');
    validateDisabledPreambleTranspilers(['06-hyphenation-rules']);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('advierte con un nombre desconocido', () => {
    const spy = spyOn(logger, 'logWarning');
    validateDisabledPreambleTranspilers(['99-no-existe']);
    expect(spy).toHaveBeenCalledWith('disabled-preamble-transpilers: "99-no-existe" no coincide con ningún preamble transpiler', 'config');
    spy.mockRestore();
  });
});
