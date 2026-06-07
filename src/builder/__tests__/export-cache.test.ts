/**
 * T4 — export-cache.test.ts
 *
 * Test de integración: verifica que el segundo export del mismo documento
 * sin cambios usa la caché y produce un archivo idéntico byte a byte.
 * Se omite automáticamente si pandoc no está disponible en el entorno.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CacheManager } from '../../cache/cache-manager.js';
import { hash } from '../../cache/hasher.js';
import { runExportDocuments } from '../export/runner.js';
import type { BuildDocument } from '../types.js';
import { getPandocVersion, isPandocAvailable } from './helpers/tools.js';

// Verificar disponibilidad de pandoc en tiempo de inicialización del módulo
// para poder usar test.skipIf — más preciso que 'return' temprano en el cuerpo
// del test (que Bun reporta como 'pass' en lugar de 'skip').
const pandocAvailable = await isPandocAvailable();

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

  // beforeEach crea un projectDir y outputDir nuevos por cada test para que
  // la caché (`.iteraciones/cache/`) esté completamente aislada entre tests.
  // Sin esto, el segundo test hereda la caché del primero y su 'primer export'
  // es en realidad un cache hit, dejando sin probar el escenario de miss.
  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'iteraciones-cache-test-'));
    outputDir = mkdtempSync(join(tmpdir(), 'iteraciones-cache-output-'));
  });

  afterEach(() => {
    if (projectDir) rmSync(projectDir, { recursive: true, force: true });
    if (outputDir) rmSync(outputDir, { recursive: true, force: true });
  });

  test.skipIf(!pandocAvailable)('hasBinary devuelve true después del primer export', async () => {
    const pandocVersion = await getPandocVersion();
    const cacheManager = new CacheManager(projectDir);
    const doc = makeExportableDoc(projectDir);

    const renderedMap = new Map([[doc.type!, [doc]]]) as Map<BuildDocument['type'] & string, BuildDocument[]>;

    await runExportDocuments(renderedMap as Parameters<typeof runExportDocuments>[0], {
      config: { epub: {} },
      outputDir,
      cwd: projectDir,
      lang: 'es',
      concurrency: 1,
      cliVersion: '0.0.0-test',
      pandocVersion,
      cacheManager,
    });

    // Calcular la misma clave que usa runner.ts para EPUB.
    // runner.ts incluye pluginFingerprint ?? '', bibHash, cslHash y templateHash
    // (que combina templates *.latex/*.css y fuentes *.ttf).
    const EXPORT_TEMPLATES_DIR = join(import.meta.dir, '../../../pandoc/export');
    const FONTS_DIR = join(import.meta.dir, '../../../fonts');
    const tplHasher = new Bun.CryptoHasher('sha256');
    const tplFiles: string[] = [];
    for await (const f of new Bun.Glob('*.latex').scan({ cwd: EXPORT_TEMPLATES_DIR })) {
      tplFiles.push(f);
    }
    for await (const f of new Bun.Glob('*.css').scan({ cwd: EXPORT_TEMPLATES_DIR })) {
      tplFiles.push(f);
    }
    tplFiles.sort();
    for (const filename of tplFiles) {
      tplHasher.update(await Bun.file(join(EXPORT_TEMPLATES_DIR, filename)).text());
      tplHasher.update('\0');
    }
    const fontFiles: string[] = [];
    for await (const f of new Bun.Glob('*.ttf').scan({ cwd: FONTS_DIR })) {
      fontFiles.push(f);
    }
    fontFiles.sort();
    for (const filename of fontFiles) {
      const buf = await Bun.file(join(FONTS_DIR, filename)).arrayBuffer();
      tplHasher.update(new Uint8Array(buf));
      tplHasher.update('\0');
    }
    const templateHash = tplHasher.digest('hex');
    const itemHashes = '';
    const cacheKey = hash(doc.sourceHash, itemHashes, 'epub', '0.0.0-test', pandocVersion, '', '', '', templateHash);
    expect(await cacheManager.hasBinary('export', cacheKey, 'epub')).toBe(true);
  });

  test.skipIf(!pandocAvailable)('el segundo export sin cambios usa caché y produce archivo idéntico', async () => {
    const pandocVersion = await getPandocVersion();
    const cacheManager = new CacheManager(projectDir);
    const doc = makeExportableDoc(projectDir);

    const renderedMap = new Map([[doc.type!, [doc]]]) as Map<BuildDocument['type'] & string, BuildDocument[]>;

    const options = {
      config: { epub: {} } as const,
      outputDir,
      cwd: projectDir,
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
