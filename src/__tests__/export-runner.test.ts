import { describe, expect, it } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { convertToEpub, convertToMarkdown, convertToPdf } from '../builder/export/runner.js';
import type { LuaFilterGroup } from '../builder/filter-resolver.js';
import { checkLatexEngine } from '../cli/doctor/system-checks.js';
import { checkPandoc } from '../lib/pandoc-runner.js';
import { withTempDir } from './helpers.js';

/** Markdown original de entrada con frontmatter (el frontmatter fluye a pandoc). */
const BODY = '---\ntitle: "Mi título"\nauthor: [Autor Uno, Autor Dos]\ndate: 2026-08-08\n---\n\nHola.\n';

/** Grupo de filtros vacío: las conversiones corren sin filtros en estos tests. */
const NO_FILTERS: LuaFilterGroup = { semantic: [], latex: [], html: [], flags: [], user: [], resolvedNames: new Set() };

const EXPORT_DOC = {
  filePath: '/proyecto/test.md',
  relativePath: 'test.md',
  metadata: {
    title: 'Mi título',
    author: ['Autor Uno', 'Autor Dos'],
    date: '8 de agosto de 2026',
    dateIso: '2026-08-08',
    lang: 'es-MX',
    documentclass: 'scrbook' as const,
    toc: false,
  },
};

const pandocOk = await checkPandoc().catch(() => null);
// unzip se usa para inspeccionar el EPUB generado: skip real si no está en PATH.
const unzipOk = (await Bun.which('unzip')) !== null;
const latexOk = (await checkLatexEngine()).ok;

describe('export/runner (convertToMarkdown)', () => {
  it.skipIf(!pandocOk)('emite el YAML con el frontmatter del documento y los metadatos complementarios', async () => {
    await withTempDir(async (dir) => {
      const out = join(dir, 'salida.md');
      await convertToMarkdown(BODY, out, EXPORT_DOC, NO_FILTERS);
      const content = await Bun.file(out).text();
      expect(content.startsWith('---\n')).toBe(true);
      // El frontmatter del documento fluye al YAML (emitido por pandoc)
      expect(content).toContain('title: Mi título');
      expect(content).toContain('- Autor Uno');
      expect(content).toContain('- Autor Dos');
      // Los complementos del CLI (defaults que no vienen del frontmatter)
      expect(content).toContain('lang: es-MX');
      expect(content).toContain('documentclass: scrbook');
      // La fecha formateada del CLI sobreescribe la cruda del frontmatter
      expect(content).toContain('date: 8 de agosto de 2026');
      expect(content).toContain('Hola.');
    });
  });

  it.skipIf(!pandocOk)('sin autor ni fecha en el frontmatter omite los campos', async () => {
    await withTempDir(async (dir) => {
      const out = join(dir, 'salida.md');
      const bodySin = '---\ntitle: "Mi título"\n---\n\nHola.\n';
      await convertToMarkdown(
        bodySin,
        out,
        { ...EXPORT_DOC, metadata: { ...EXPORT_DOC.metadata, author: [], date: undefined, dateIso: undefined } },
        NO_FILTERS,
      );
      const content = await Bun.file(out).text();
      expect(content).not.toContain('author:');
      expect(content).not.toContain('date:');
    });
  });
});

describe('export/runner (convertToEpub)', () => {
  it.skipIf(!pandocOk || !unzipOk)('genera un EPUB con los metadatos del documento', async () => {
    await withTempDir(async (dir) => {
      const out = join(dir, 'libro.epub');
      await convertToEpub(BODY, out, EXPORT_DOC, NO_FILTERS);
      const proc = Bun.spawn(['unzip', '-p', out, 'EPUB/content.opf'], { stdout: 'pipe', stderr: 'pipe' });
      const [stdout, , code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
      expect(code).toBe(0);
      expect(stdout).toContain('Mi título</dc:title>');
      expect(stdout).toContain('Autor Uno');
      expect(stdout).toContain('>es-MX</dc:language>');
      expect(stdout).toContain('>2026-08-08</dc:date>');
    });
  });
});

describe('export/runner (convertToPdf)', () => {
  it.skipIf(!latexOk)('con un .tex roto lanza PandocError con la ruta del log para diagnóstico', async () => {
    await withTempDir(async (dir) => {
      const tex = join(dir, 'roto.tex');
      await writeFile(tex, '\\documentclass{article}\n\\usepackage{paquete-inexistente-xyz}\n\\begin{document}\nHola\n\\end{document}\n', 'utf8');
      await expect(convertToPdf(tex, 'doc.md', dir, 'roto')).rejects.toThrow('latexmk falló al generar el PDF');
      // El log completo queda en el área de trabajo para diagnóstico
      expect(await Bun.file(join(dir, 'roto.log')).exists()).toBe(true);
    });
  });
});
