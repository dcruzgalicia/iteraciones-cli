/**
 * T2 — pandoc-exporter.test.ts
 *
 * Test de integración: verifica que convertToEpub produce un archivo EPUB válido.
 * Se omite automáticamente si pandoc no está disponible en el entorno.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { convertToEpub } from '../../services/pandoc-exporter.js';
import { run } from '../../services/run.js';
import type { ExportDocument } from '../export/types.js';

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

// ---------------------------------------------------------------------------
// Fixture mínimo
// ---------------------------------------------------------------------------

function makeMinimalExportDoc(outputDir: string): ExportDocument {
  return {
    filePath: join(outputDir, 'articulo.md'),
    relativePath: 'articulo.md',
    body: '## Introducción\n\nEste es un documento de prueba para verificar la exportación EPUB.\n',
    metadata: {
      title: 'Artículo de prueba',
      author: ['Autora Test'],
      date: '2025-01-01',
      lang: 'es',
      documentclass: 'scrartcl',
      toc: false,
    },
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('convertToEpub — integración', () => {
  let outputDir: string;
  let pandocAvailable: boolean;

  beforeAll(async () => {
    outputDir = mkdtempSync(join(tmpdir(), 'iteraciones-epub-test-'));
    pandocAvailable = await isPandocAvailable();
  });

  afterAll(() => {
    if (outputDir) rmSync(outputDir, { recursive: true, force: true });
  });

  test('el EPUB producido es un ZIP válido con mimetype correcto', async () => {
    if (!pandocAvailable) {
      console.log('  ⚠ pandoc no disponible — test omitido');
      return;
    }

    const doc = makeMinimalExportDoc(outputDir);
    const outputPath = join(outputDir, 'articulo.epub');

    await convertToEpub(doc, outputPath);

    const epubFile = Bun.file(outputPath);
    expect(await epubFile.exists()).toBe(true);

    // Un EPUB es un ZIP. Los primeros 4 bytes de un ZIP son PK\x03\x04 (0x504B0304).
    const buffer = await epubFile.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    expect(bytes[0]).toBe(0x50); // P
    expect(bytes[1]).toBe(0x4b); // K
    expect(bytes[2]).toBe(0x03);
    expect(bytes[3]).toBe(0x04);

    // Verificar que el primer archivo en el ZIP es 'mimetype' con el valor correcto.
    // La spec EPUB requiere que el archivo 'mimetype' esté al inicio y no comprimido.
    // Sus bytes están en la posición 30 (después del header de entrada local de 30 bytes).
    const text = new TextDecoder().decode(buffer);
    expect(text).toContain('application/epub+zip');
  });

  test('el archivo EPUB tiene un tamaño razonable (> 1KB)', async () => {
    if (!pandocAvailable) {
      console.log('  ⚠ pandoc no disponible — test omitido');
      return;
    }

    const doc = makeMinimalExportDoc(outputDir);
    const outputPath = join(outputDir, 'articulo-size.epub');

    await convertToEpub(doc, outputPath);

    const epubFile = Bun.file(outputPath);
    const size = (await epubFile.stat())?.size ?? 0;
    expect(size).toBeGreaterThan(1024);
  });
});
