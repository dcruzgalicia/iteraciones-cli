/**
 * T4 — export-cache.test.ts
 *
 * Test de integración: verifica que el segundo export del mismo documento
 * sin cambios usa la caché y produce un archivo idéntico byte a byte.
 * Se omite automáticamente si pandoc no está disponible en el entorno.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CacheManager } from '../../cache/cache-manager.js';
import { hash } from '../../cache/hasher.js';
import { run } from '../../services/run.js';
import { runExportDocuments } from '../export/runner.js';
import type { BuildDocument } from '../types.js';

// ---------------------------------------------------------------------------
// Helper: verificar disponibilidad de pandoc
// ---------------------------------------------------------------------------

async function isPandocAvailable(): Promise<boolean> {
  try {
    const result = await run('pandoc', ['--version']);
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

async function getPandocVersion(): Promise<string> {
  try {
    const result = await run('pandoc', ['--version']);
    return result.stdout.split('\n')[0]?.trim() ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

// ---------------------------------------------------------------------------
// Helper: construir BuildDocument mínimo para exportación
// ---------------------------------------------------------------------------

function makeExportableDoc(cwd: string): BuildDocument {
  return {
    filePath: join(cwd, 'articulo.md'),
    relativePath: 'articulo.md',
    frontmatter: {
      title: 'Artículo de caché',
      date: '2025-01-01',
      author: ['Autora Cache'],
      speakers: [],
      type: 'file',
      keywords: [],
      region: '',
      block: false,
      draft: false,
      items: [],
    },
    body: '## Sección\n\nContenido para el test de caché.\n',
    sourceHash: 'b'.repeat(64),
    mtimeMs: Date.now(),
    type: 'file',
    kind: 'page',
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('export cache — integración', () => {
  let projectDir: string;
  let outputDir: string;
  let pandocAvailable: boolean;

  beforeAll(async () => {
    projectDir = mkdtempSync(join(tmpdir(), 'iteraciones-cache-test-'));
    outputDir = mkdtempSync(join(tmpdir(), 'iteraciones-cache-output-'));
    pandocAvailable = await isPandocAvailable();
    if (!pandocAvailable) {
      console.log('  ⚠ pandoc no disponible — tests de caché omitidos');
    }
  });

  afterAll(() => {
    if (projectDir) rmSync(projectDir, { recursive: true, force: true });
    if (outputDir) rmSync(outputDir, { recursive: true, force: true });
  });

  test('hasBinary devuelve true después del primer export', async () => {
    if (!pandocAvailable) return;

    const pandocVersion = await getPandocVersion();
    const cacheManager = new CacheManager(projectDir);
    const doc = makeExportableDoc(projectDir);

    const renderedMap = new Map([[doc.type!, [doc]]]) as Map<BuildDocument['type'] & string, BuildDocument[]>;

    await runExportDocuments(renderedMap as Parameters<typeof runExportDocuments>[0], {
      config: { formats: ['epub'], pdfEngine: 'xelatex' },
      outputDir,
      lang: 'es',
      concurrency: 1,
      cliVersion: '0.0.0-test',
      pandocVersion,
      cacheManager,
    });

    // Calcular la misma clave que usa runner.ts para EPUB
    const itemHashes = '';
    const cacheKey = hash(doc.sourceHash, itemHashes, 'epub', '0.0.0-test', pandocVersion);
    expect(await cacheManager.hasBinary('export', cacheKey, 'epub')).toBe(true);
  });

  test('el segundo export sin cambios usa caché y produce archivo idéntico', async () => {
    if (!pandocAvailable) return;

    const pandocVersion = await getPandocVersion();
    const cacheManager = new CacheManager(projectDir);
    const doc = makeExportableDoc(projectDir);

    const renderedMap = new Map([[doc.type!, [doc]]]) as Map<BuildDocument['type'] & string, BuildDocument[]>;

    const options = {
      config: { formats: ['epub'] as ('epub' | 'pdf')[], pdfEngine: 'xelatex' as const },
      outputDir,
      lang: 'es',
      concurrency: 1,
      cliVersion: '0.0.0-test',
      pandocVersion,
      cacheManager,
    };

    // Primer export: genera y guarda en caché
    const results1 = await runExportDocuments(renderedMap as Parameters<typeof runExportDocuments>[0], options);
    expect(results1).toHaveLength(1);
    expect(results1[0]?.epubPath).toBeDefined();

    // Leer el archivo del primer export
    const epubPath1 = results1[0]!.epubPath!;
    const bytes1 = await Bun.file(epubPath1).arrayBuffer();

    // Segundo export: debe usar caché
    // Borrar el archivo de salida para forzar que se copie desde caché
    await Bun.write(epubPath1, new Uint8Array(0));

    const results2 = await runExportDocuments(renderedMap as Parameters<typeof runExportDocuments>[0], options);
    expect(results2).toHaveLength(1);

    const bytes2 = await Bun.file(results2[0]!.epubPath!).arrayBuffer();

    // Los bytes deben ser idénticos
    expect(bytes1.byteLength).toBe(bytes2.byteLength);
    expect(new Uint8Array(bytes1)).toEqual(new Uint8Array(bytes2));
  });
});
