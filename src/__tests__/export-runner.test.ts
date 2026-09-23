import { describe, expect, it, spyOn } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { convertToEpub, convertToMarkdown, convertToPdf } from '../builder/export/runner.js';
import type { LuaFilterGroup } from '../builder/filter-resolver.js';
import { checkLatexEngine } from '../cli/doctor/system-checks.js';
import * as pandocRunnerLib from '../lib/pandoc-runner.js';
import { getPandocVersion } from '../lib/pandoc-runner.js';
import { exec } from '../lib/run.js';
import { registerSkip, SKIP_REASONS, withTempDir } from './helpers.js';

/** Markdown original de entrada con frontmatter (el frontmatter fluye a pandoc). */
const BODY = '---\ntitle: "Mi título"\ncreator: [Autor Uno, Autor Dos]\ndate: 2026-08-08\n---\n\nHola.\n';

/** Grupo de filtros vacío: las conversiones corren sin filtros en estos tests. */
const NO_FILTERS: LuaFilterGroup = { semantic: [], latex: [], html: [], flags: [], user: [], resolvedNames: new Set() };

const EXPORT_DOC = {
  filePath: '/proyecto/test.md',
  relativePath: 'test.md',
  metadata: {
    title: 'Mi título',
    creator: ['Autor Uno', 'Autor Dos'],
    date: '8 de agosto de 2026',
    dateIso: '2026-08-08',
    language: 'es-MX',
    toc: false,
  },
};

const pandocOk = await getPandocVersion().catch(() => null);
if (!pandocOk) registerSkip('export-runner.test.ts', SKIP_REASONS.pandoc);
// unzip se usa para inspeccionar el EPUB generado: skip real si no está en PATH.
const unzipOk = (await Bun.which('unzip')) !== null;
const latexOk = (await checkLatexEngine()).ok;

describe('export/runner (convertToMarkdown)', () => {
  it('emite el frontmatter del origen completo y el body tal cual (#2436)', async () => {
    await withTempDir(async (dir) => {
      const out = join(dir, 'salida.md');
      await convertToMarkdown(BODY, out, EXPORT_DOC);
      const content = await Bun.file(out).text();
      expect(content.startsWith('---\n')).toBe(true);
      // Campos del frontmatter de origen tal cual: la fecha se preserva en crudo
      // (humanizarla en cada export rompía la idempotencia del re-proceso)
      expect(content).toContain('title: Mi título');
      expect(content).toContain('- Autor Uno');
      expect(content).toContain('- Autor Dos');
      expect(content).toContain('date: 2026-08-08');
      // language se completa desde la config del sitio cuando el origen no lo trae
      expect(content).toContain('language: es-MX');
      // Body intacto, con la línea en blanco que lo separa del frontmatter
      expect(content.endsWith('---\n\nHola.\n')).toBe(true);
    });
  });

  it('no emite documentclass, rutas absolutas ni bibliography/csl (#2436)', async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, 'refs.bib'), '@book{k, title = {K}}', 'utf8');
      await writeFile(join(dir, 'nature.csl'), '<?xml version="1.0"?><style version="1.0"/>', 'utf8');
      const out = join(dir, 'salida.md');
      const doc = {
        ...EXPORT_DOC,
        metadata: { ...EXPORT_DOC.metadata, bibliography: join(dir, 'refs.bib'), csl: join(dir, 'nature.csl') },
      };
      await convertToMarkdown(BODY, out, doc, {});
      const content = await Bun.file(out).text();
      expect(content).not.toContain('documentclass');
      expect(content).not.toContain(dir);
      // bib/csl no viajan en el md: al re-procesarlos vienen de la config del sitio
      expect(content).not.toContain('bibliography:');
      expect(content).not.toContain('csl:');
    });
  });

  it('sin creator ni date en el frontmatter omite los campos', async () => {
    await withTempDir(async (dir) => {
      const out = join(dir, 'salida.md');
      const bodySin = '---\ntitle: "Mi título"\n---\n\nHola.\n';
      await convertToMarkdown(bodySin, out, { ...EXPORT_DOC, metadata: { ...EXPORT_DOC.metadata, creator: [], date: undefined, dateIso: undefined } });
      const content = await Bun.file(out).text();
      expect(content).not.toContain('creator:');
      expect(content).not.toContain('date:');
    });
  });

  it('re-procesar su propia salida es byte-idéntico (#2436)', async () => {
    await withTempDir(async (dir) => {
      const primera = join(dir, 'a.md');
      await convertToMarkdown(BODY, primera, EXPORT_DOC);
      const salida = await Bun.file(primera).text();
      const segunda = join(dir, 'b.md');
      await convertToMarkdown(salida, segunda, EXPORT_DOC);
      expect(await Bun.file(segunda).text()).toBe(salida);
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

  it.skipIf(!pandocOk || !unzipOk)('el frontmatter language sobreescribe el idioma del EPUB (contrato unificado #2010)', async () => {
    await withTempDir(async (dir) => {
      const out = join(dir, 'libro.epub');
      await convertToEpub(BODY, out, EXPORT_DOC, NO_FILTERS, undefined, { language: 'en' });
      const proc = Bun.spawn(['unzip', '-p', out, 'EPUB/content.opf'], { stdout: 'pipe', stderr: 'pipe' });
      const [stdout, , code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
      expect(code).toBe(0);
      expect(stdout).toContain('>en</dc:language>');
      expect(stdout).not.toContain('>es-MX</dc:language>');
    });
  });

  it('con citas aplica el CSL configurado y, sin él, el APA-7 empaquetado (paridad HTML, #2165)', async () => {
    await withTempDir(async (dir) => {
      const capturas: { extraArgs: string[] }[] = [];
      const spy = spyOn(pandocRunnerLib, 'execPandoc').mockImplementation(async (opts) => {
        capturas.push(opts as { extraArgs: string[] });
        return '';
      });
      try {
        const conCsl = { ...EXPORT_DOC, metadata: { ...EXPORT_DOC.metadata, bibliography: join(dir, 'refs.bib'), csl: join(dir, 'estilo.csl') } };
        await convertToEpub(BODY, join(dir, 'a.epub'), conCsl, NO_FILTERS);
        const sinCsl = { ...EXPORT_DOC, metadata: { ...EXPORT_DOC.metadata, bibliography: join(dir, 'refs.bib') } };
        await convertToEpub(BODY, join(dir, 'b.epub'), sinCsl, NO_FILTERS);
        // Sin bibliography no hay citeproc ni CSL
        await convertToEpub(BODY, join(dir, 'c.epub'), EXPORT_DOC, NO_FILTERS);
      } finally {
        spy.mockRestore();
      }
      expect(capturas).toHaveLength(3);
      const argsCon = capturas[0]?.extraArgs ?? [];
      expect(argsCon).toContain('--citeproc');
      expect(argsCon).toContain(join(dir, 'estilo.csl'));
      const argsSin = capturas[1]?.extraArgs ?? [];
      expect(argsSin).toContain('--citeproc');
      expect(argsSin.filter((a) => a.endsWith('apa-7.csl'))).toHaveLength(1);
      const argsSinBib = capturas[2]?.extraArgs ?? [];
      expect(argsSinBib).not.toContain('--citeproc');
      expect(argsSinBib.filter((a) => a.endsWith('.csl'))).toHaveLength(0);
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

  // Smoke con compilación real: latexmk+biber tardan más que el timeout por defecto
  it.skipIf(!latexOk)(
    'compila con espacios en bibliografía e imagen: cita e incrusta sin error (#2015)',
    async () => {
      await withTempDir(async (dir) => {
        await writeFile(join(dir, 'mi bibliografia.bib'), '@book{autor2020, title={Libro}, author={Autora}, year={2020}}\n', 'utf8');
        // PNG válido de 1×1 px (base64): suficiente para \includegraphics
        const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
        await writeFile(join(dir, 'mi imagen.png'), png);
        const bibPath = join(dir, 'mi bibliografia.bib').replaceAll('\\', '/');
        const imgPath = join(dir, 'mi imagen.png').replaceAll('\\', '/');
        const tex = [
          '\\documentclass{article}',
          '\\usepackage[backend=biber]{biblatex}',
          `\\addbibresource{${bibPath}}`,
          '\\usepackage{graphicx}',
          '\\begin{document}',
          'Hola \\cite{autor2020}.',
          `\\includegraphics{${imgPath}}`,
          '\\printbibliography',
          '\\end{document}',
        ].join('\n');
        const texPath = join(dir, 'con espacios.tex');
        await writeFile(texPath, tex, 'utf8');
        // convertToPdf publica el PDF en pdfDir con el nombre del slug
        await convertToPdf(texPath, 'doc.md', dir, 'salida');
        const pdfPath = join(dir, 'salida.pdf');
        expect(await Bun.file(pdfPath).exists()).toBe(true);
        // La cita resolvió vía biber a través de la ruta con espacios
        const text = await exec('pdftotext', [pdfPath, '-']);
        expect(text.stdout).toContain('Autora');
      });
    },
    120_000,
  );
});
