import { describe, expect, it, spyOn } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BUILTIN_PREAMBLE_FILTERS,
  getBuiltinPreambleFilterInfos,
  loadPreambleFilters,
  validateDisabledPreambleFilters,
} from '../builder/preamble-loader.js';
import * as logger from '../lib/logger.js';

describe('preamble-loader', () => {
  it('lista los 6 filters built-in con descripción', () => {
    const infos = getBuiltinPreambleFilterInfos();
    expect(infos).toHaveLength(6);
    expect(infos.map((i) => i.name)).toEqual(BUILTIN_PREAMBLE_FILTERS);
    expect(infos.every((i) => i.description.length > 0)).toBe(true);
  });

  it('carga el contenido .tex del paquete para todos los filters', async () => {
    const filters = await loadPreambleFilters();
    expect(filters).toHaveLength(6);
    const biblio = filters.find((t) => t.name === '05-bibliography-heading');
    expect(biblio?.content).toContain('\\ifcsname ver@biblatex.sty\\endcsname');
    expect(biblio?.content).toContain('\\defbibheading{bibintoc}[\\refname]{%');
    const maketitle = filters.find((t) => t.name === '01-maketitle-patches');
    expect(maketitle?.content).toContain('\\renewcommand{\\maketitle}{%');
  });

  it('respeta la disabled list', async () => {
    const filters = await loadPreambleFilters(['06-hyphenation-rules']);
    expect(filters.map((t) => t.name)).not.toContain('06-hyphenation-rules');
    expect(filters).toHaveLength(5);
  });

  it('un .tex del proyecto reemplaza al del paquete', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'iteraciones-preamble-'));
    try {
      mkdirSync(join(cwd, 'preamble'), { recursive: true });
      writeFileSync(join(cwd, 'preamble', '06-hyphenation-rules.tex'), '% --- Override de proyecto ---\nhyphenation{OverridePrueba}\n');
      const filters = await loadPreambleFilters(undefined, cwd);
      const hyphen = filters.find((t) => t.name === '06-hyphenation-rules');
      expect(hyphen?.content).toContain('OverridePrueba');
      expect(hyphen?.content).not.toContain('Separacion silabica');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe('validateDisabledPreambleFilters', () => {
  it('no advierte con undefined o lista vacía', () => {
    const spy = spyOn(logger, 'logWarning');
    validateDisabledPreambleFilters(undefined);
    validateDisabledPreambleFilters([]);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('no advierte con nombres válidos', () => {
    const spy = spyOn(logger, 'logWarning');
    validateDisabledPreambleFilters(['06-hyphenation-rules']);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('advierte con un nombre desconocido', () => {
    const spy = spyOn(logger, 'logWarning');
    validateDisabledPreambleFilters(['99-no-existe']);
    expect(spy).toHaveBeenCalledWith('disabled-preamble-filters: "99-no-existe" no coincide con ningún preamble filter', 'config');
    spy.mockRestore();
  });
});
