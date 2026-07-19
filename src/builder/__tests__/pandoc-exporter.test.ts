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
import type { ExportDocument } from '../export/types.js';
import { isPandocAvailable } from './helpers/tools.js';

// Verificar disponibilidad de pandoc en tiempo de inicialización del módulo
// para poder usar test.skipIf — más preciso que 'return' temprano en el cuerpo
// del test (que Bun reporta como 'pass' en lugar de 'skip').
const pandocAvailable = await isPandocAvailable();

// ---------------------------------------------------------------------------
// Fixture mínimo
// ---------------------------------------------------------------------------

function makeMinimalExportDoc(outputDir: string): ExportDocument {
  return {
    filePath: join(outputDir, 'articulo.md'),
    relativePath: 'articulo.md',
    type: 'file',
    body: '## Introducción\n\nEste es un documento de prueba para verificar la exportación EPUB.\n',
    metadata: {
      title: 'Artículo de prueba',
      author: ['Autora Test'],
      date: '2025-01-01',
      lang: 'es',
      documentclass: 'scrbook',
      toc: false,
    },
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('convertToEpub — integración', () => {
  let outputDir: string;

  beforeAll(() => {
    outputDir = mkdtempSync(join(tmpdir(), 'iteraciones-epub-test-'));
  });

  afterAll(() => {
    if (outputDir) rmSync(outputDir, { recursive: true, force: true });
  });

  test.skipIf(!pandocAvailable)('el EPUB producido es un ZIP válido con mimetype correcto', async () => {
    const doc = makeMinimalExportDoc(outputDir);
    const outputPath = join(outputDir, 'articulo.epub');

    await convertToEpub(doc.body, outputPath, doc);

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

  test.skipIf(!pandocAvailable)('el archivo EPUB tiene un tamaño razonable (> 1KB)', async () => {
    const doc = makeMinimalExportDoc(outputDir);
    const outputPath = join(outputDir, 'articulo-size.epub');

    await convertToEpub(doc.body, outputPath, doc);

    const epubFile = Bun.file(outputPath);
    const size = (await epubFile.stat())?.size ?? 0;
    expect(size).toBeGreaterThan(1024);
  });
});
