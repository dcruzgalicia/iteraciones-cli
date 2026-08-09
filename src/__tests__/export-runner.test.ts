import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { convertToEpub, convertToMarkdown } from '../builder/export/runner.js';
import { checkPandoc } from '../lib/pandoc-runner.js';

/** AST canónico mínimo (válido para pandoc). */
const AST = { 'pandoc-api-version': [1, 23], meta: {}, blocks: [{ t: 'Para', c: [{ t: 'Str', c: 'Hola' }] }] };

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

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'iteraciones-cli-test-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const pandocOk = await checkPandoc().catch(() => null);

describe('export/runner (convertToMarkdown)', () => {
  it.skipIf(!pandocOk)('escribe el YAML con title, author, date, lang y documentclass', async () => {
    await withTempDir(async (dir) => {
      const out = join(dir, 'salida.md');
      await convertToMarkdown(AST, out, EXPORT_DOC, []);
      const content = await Bun.file(out).text();
      expect(content.startsWith('---\n')).toBe(true);
      expect(content).toContain('title: "Mi título"');
      expect(content).toContain('author:');
      expect(content).toContain('Autor Uno');
      expect(content).toContain('Autor Dos');
      expect(content).toContain('lang: "es-MX"');
      expect(content).toContain('documentclass: "scrbook"');
      expect(content).toContain('Hola');
    });
  });

  it.skipIf(!pandocOk)('sin autor ni fecha omite los campos', async () => {
    await withTempDir(async (dir) => {
      const out = join(dir, 'salida.md');
      await convertToMarkdown(AST, out, { ...EXPORT_DOC, metadata: { ...EXPORT_DOC.metadata, author: [], date: undefined, dateIso: undefined } }, []);
      const content = await Bun.file(out).text();
      expect(content).not.toContain('author:');
      expect(content).not.toContain('date:');
    });
  });
});

describe('export/runner (convertToEpub)', () => {
  it.skipIf(!pandocOk)('genera un EPUB con los metadatos del documento', async () => {
    await withTempDir(async (dir) => {
      const out = join(dir, 'libro.epub');
      await convertToEpub(AST, out, EXPORT_DOC, []);
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
