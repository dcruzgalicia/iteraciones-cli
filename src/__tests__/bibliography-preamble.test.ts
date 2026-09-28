import { describe, expect, it, spyOn } from 'bun:test';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BuildMetadata } from '../builder/build-planner.js';
import { convertToPdf } from '../builder/export/runner.js';
import { writeEffectiveTemplates } from '../builder/pipeline-setup.js';
import { disableBibliographyWithoutBibFiles, resolveEffectiveDisabledPreamble } from '../builder/preamble-loader.js';
import type { BuildContext } from '../builder/types.js';
import { listFilters } from '../cli/filters.js';
import { runTemplate } from '../cli/template.js';
import { DEFAULT_SITE_CONFIG, resolveDisabledPreambleConfig } from '../config/site-config.js';
import { initTestProject, withTempDir } from './helpers.js';

/**
 * #2419 — un proyecto sin archivos `.bib` no cita nada: se apaga el snippet de
 * preamble `11-bibliography` (csquotes + biblatex) y latexmk va con
 * `-nobibtex`. Aquí se cubre la regla compartida y los tres sitios que la
 * aplican (build, `iteraciones template`, `iteraciones filters`), que tienen
 * que decir lo mismo porque el .sh regenera las plantillas con `template`.
 */

const DISABLED = resolveEffectiveDisabledPreamble(resolveDisabledPreambleConfig(DEFAULT_SITE_CONFIG));

describe('regla 11-bibliography sin archivos .bib (#2419)', () => {
  it('sin .bib apaga el snippet; con .bib no lo toca', () => {
    expect(disableBibliographyWithoutBibFiles([], [])).toEqual(['11-bibliography']);
    expect(disableBibliographyWithoutBibFiles([], ['/p/libro.bib'])).toEqual([]);
  });

  it('sin lista previa de bibFiles no se arriesga a desactivar nada', () => {
    expect(disableBibliographyWithoutBibFiles([], undefined)).toEqual([]);
  });

  it('no duplica si la config ya desactivaba 11-bibliography', () => {
    expect(disableBibliographyWithoutBibFiles(['11-bibliography'], [])).toEqual(['11-bibliography']);
  });
});

describe('el build escribe la plantilla LaTeX (#2419)', () => {
  async function composeLatex(dir: string, bibFiles: string[]) {
    const ctx: BuildContext = { siteConfig: DEFAULT_SITE_CONFIG, cwd: dir, outputDir: join(dir, 'dist'), needsCss: false, concurrency: 1 };
    const plan = { generateLatex: true } as BuildMetadata;
    const state = await writeEffectiveTemplates(ctx, plan, false, DEFAULT_SITE_CONFIG, bibFiles, DISABLED);
    return { tex: await Bun.file(state.latexTemplatePath).text(), state };
  }

  it('proyecto sin .bib: la plantilla no carga biblatex y biblatexAvailable queda false', async () => {
    await withTempDir(async (dir) => {
      const { tex, state } = await composeLatex(dir, []);
      expect(tex).not.toContain('\\usepackage{csquotes}');
      expect(tex).not.toContain('\\usepackage[style=apa]{biblatex}');
      expect(state.biblatexAvailable).toBe(false);
    });
  });

  it('proyecto con .bib: el snippet vuelve y biblatexAvailable queda true', async () => {
    await withTempDir(async (dir) => {
      const { tex, state } = await composeLatex(dir, [join(dir, 'libro.bib')]);
      expect(tex).toContain('\\usepackage[style=apa]{biblatex}');
      expect(state.biblatexAvailable).toBe(true);
    });
  });
});

describe('iteraciones template (#2419)', () => {
  it('escribe la misma regla que el build: el .sh regenera plantillas byte-idénticas', async () => {
    const prevExitCode = process.exitCode;
    try {
      await withTempDir(async (dir) => {
        await initTestProject(dir);
        // logSuccess de `template` no aporta nada aquí: se traga el stdout.
        const stdoutSpy = spyOn(process.stdout, 'write').mockImplementation(() => true);
        try {
          await runTemplate(dir, 'latex', {});
          expect(await Bun.file(join(dir, '.iteraciones', 'templates', 'latex.tex')).text()).not.toContain('\\usepackage[style=apa]{biblatex}');

          // Aparece un .bib: la siguiente plantilla ya incluye biblatex.
          await writeFile(join(dir, 'libro.bib'), '@book{ref,\n  title = {T}\n}\n', 'utf8');
          await runTemplate(dir, 'latex', {});
          expect(await Bun.file(join(dir, '.iteraciones', 'templates', 'latex.tex')).text()).toContain('\\usepackage[style=apa]{biblatex}');
        } finally {
          stdoutSpy.mockRestore();
        }
      });
    } finally {
      process.exitCode = prevExitCode;
    }
  });
});

describe('iteraciones filters (#2419)', () => {
  async function estadoBibliography(dir: string): Promise<boolean | undefined> {
    const spy = spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      await listFilters(dir, { json: true });
      const output = spy.mock.calls.map((call) => String(call[0])).join('');
      const parsed = JSON.parse(output) as { preamble: { name: string; active: boolean }[] };
      return parsed.preamble.find((info) => info.name === '11-bibliography')?.active;
    } finally {
      spy.mockRestore();
    }
  }

  it('muestra el mismo estado que aplica el build', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      expect(await estadoBibliography(dir)).toBe(false);

      await writeFile(join(dir, 'libro.bib'), '@book{ref,\n  title = {T}\n}\n', 'utf8');
      expect(await estadoBibliography(dir)).toBe(true);
    });
  });
});

describe('convertToPdf (#2419)', () => {
  it('latexmk recibe -nobibtex cuando noBibtex es true y no lo recibe en caso contrario', async () => {
    await withTempDir(async (dir) => {
      const binDir = join(dir, 'bin');
      const argsFile = join(dir, 'latexmk-args.txt');
      await mkdir(binDir);
      const fake = join(binDir, 'latexmk');
      await writeFile(fake, `#!/bin/sh\nprintf '%s\\n' "$@" > '${argsFile}'\n`, 'utf8');
      await chmod(fake, 0o755);

      const texPath = join(dir, 'doc.tex');
      await writeFile(texPath, '\\documentclass{article}\n\\begin{document}\nhola\n\\end{document}\n', 'utf8');
      const pdfDir = join(dir, 'slot');
      const prevPath = process.env.PATH;
      process.env.PATH = `${binDir}:${prevPath ?? ''}`;
      try {
        // Sin pdfDest no hay nada que recoger: el slot se limpia y no hace falta
        // que el latexmk falso genere un PDF.
        await convertToPdf(texPath, 'doc.md', pdfDir, 'salida', undefined, undefined, true);
        expect(await Bun.file(argsFile).text()).toContain('-nobibtex');

        await convertToPdf(texPath, 'doc.md', pdfDir, 'salida');
        expect(await Bun.file(argsFile).text()).not.toContain('-nobibtex');
      } finally {
        process.env.PATH = prevPath;
      }
    });
  });
});
