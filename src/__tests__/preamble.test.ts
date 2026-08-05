import { describe, expect, it, spyOn } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildLatexPreamble } from '../builder/latex-preamble.js';
import {
  BUILTIN_PREAMBLE_FILTERS,
  getBuiltinPreambleFilterInfos,
  loadPreambleFilters,
  validateDisabledPreambleFilters,
} from '../builder/preamble-loader.js';
import * as logger from '../lib/logger.js';

describe('preamble-loader', () => {
  it('lista los preamble filters built-in con descripción', () => {
    const infos = getBuiltinPreambleFilterInfos();
    expect(infos).toHaveLength(BUILTIN_PREAMBLE_FILTERS.length);
    expect(infos.map((i) => i.name)).toEqual(BUILTIN_PREAMBLE_FILTERS);
    expect(infos.every((i) => i.description.length > 0)).toBe(true);
  });

  it('carga el contenido .tex del paquete para todos los filters', async () => {
    const filters = await loadPreambleFilters();
    expect(filters).toHaveLength(BUILTIN_PREAMBLE_FILTERS.length);
    const biblio = filters.find((t) => t.name === '23-bibliography-heading');
    expect(biblio?.content).toContain('\\ifcsname ver@biblatex.sty\\endcsname');
    expect(biblio?.content).toContain('\\defbibheading{bibintoc}[\\refname]{%');
    const maketitle = filters.find((t) => t.name === '19-maketitle-patches');
    expect(maketitle?.content).toContain('\\renewcommand{\\maketitle}{%');
  });

  it('respeta la disabled list', async () => {
    const filters = await loadPreambleFilters(['24-hyphenation-rules']);
    expect(filters.map((t) => t.name)).not.toContain('24-hyphenation-rules');
    expect(filters).toHaveLength(23);
  });

  it('un .tex del proyecto reemplaza al del paquete', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'iteraciones-preamble-'));
    try {
      mkdirSync(join(cwd, 'preamble'), { recursive: true });
      writeFileSync(join(cwd, 'preamble', '24-hyphenation-rules.tex'), 'hyphenation{OverridePrueba}\n');
      const filters = await loadPreambleFilters(undefined, cwd);
      const hyphen = filters.find((t) => t.name === '24-hyphenation-rules');
      expect(hyphen?.content).toContain('OverridePrueba');
      expect(hyphen?.content).not.toContain('Separacion silabica');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe('buildLatexPreamble', () => {
  it('emite \\author{} con los autores del documento', async () => {
    const preamble = await buildLatexPreamble(undefined, { title: 'Título', author: ['Juan Pérez', 'Ana López'] });
    const authorLine = preamble.find((line) => line.startsWith('\\author{'));
    expect(authorLine).toBe('\\author{Juan Pérez \\and Ana López}');
  });

  it('emite \\author{} vacío cuando no hay author para mantener la posición del título', async () => {
    const preamble = await buildLatexPreamble(undefined, { title: 'Título' });
    const authorLine = preamble.find((line) => line.startsWith('\\author{'));
    expect(authorLine).toBe('\\author{}');
  });

  it('emite \\author{} vacío cuando author es una lista vacía', async () => {
    const preamble = await buildLatexPreamble(undefined, { title: 'Título', author: [] });
    const authorLine = preamble.find((line) => line.startsWith('\\author{'));
    expect(authorLine).toBe('\\author{}');
  });

  it('emite \\author{} después de \\title y antes de \\date', async () => {
    const preamble = await buildLatexPreamble(undefined, { title: 'Título' });
    const titleIdx = preamble.findIndex((line) => line.startsWith('\\title{'));
    const authorIdx = preamble.findIndex((line) => line.startsWith('\\author{'));
    const dateIdx = preamble.findIndex((line) => line.startsWith('\\date{'));
    expect(authorIdx).toBeGreaterThan(titleIdx);
    expect(dateIdx).toBeGreaterThan(authorIdx);
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
    validateDisabledPreambleFilters(['24-hyphenation-rules']);
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
