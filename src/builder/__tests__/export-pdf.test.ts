/**
 * T3 — export-pdf.test.ts
 *
 * Test de integración: verifica que convertToPdf produce un archivo PDF válido.
 * Se omite automáticamente si pandoc o pdflatex no están disponibles en el entorno.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { convertToPdf } from '../../services/pandoc-exporter.js';
import type { ExportDocument } from '../export/types.js';
import { isPandocAvailable, isPdflatexAvailable } from './helpers/tools.js';

// Verificar disponibilidad de pandoc y pdflatex en tiempo de inicialización del
// módulo para poder usar test.skipIf — más preciso que 'return' temprano en el
// cuerpo del test (que Bun reporta como 'pass' en lugar de 'skip').
const [pandocReady, pdflatexReady] = await Promise.all([isPandocAvailable(), isPdflatexAvailable()]);
const toolsAvailable = pandocReady && pdflatexReady;

// ---------------------------------------------------------------------------
// Fixture mínimo
// ---------------------------------------------------------------------------

function makeMinimalExportDoc(outputDir: string): ExportDocument {
  return {
    filePath: join(outputDir, 'articulo.md'),
    relativePath: 'articulo.md',
    type: 'file',
    body: '## Introducción\n\nEste es un documento de prueba para verificar la exportación PDF.\n',
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

describe('convertToPdf — integración', () => {
  let outputDir: string;

  beforeAll(() => {
    outputDir = mkdtempSync(join(tmpdir(), 'iteraciones-pdf-test-'));
  });

  afterAll(() => {
    if (outputDir) rmSync(outputDir, { recursive: true, force: true });
  });

  test.skipIf(!toolsAvailable)('el PDF producido comienza con el header %PDF-', async () => {
    const doc = makeMinimalExportDoc(outputDir);
    const outputPath = join(outputDir, 'articulo.pdf');

    await convertToPdf(doc, outputPath);

    const pdfFile = Bun.file(outputPath);
    expect(await pdfFile.exists()).toBe(true);

    // Verificar la firma magic de PDF: los primeros 5 bytes son '%PDF-'
    const buffer = await pdfFile.arrayBuffer();
    const header = new TextDecoder().decode(new Uint8Array(buffer, 0, 5));
    expect(header).toBe('%PDF-');
  });

  test.skipIf(!toolsAvailable)('el archivo PDF tiene un tamaño razonable (> 5KB)', async () => {
    const doc = makeMinimalExportDoc(outputDir);
    const outputPath = join(outputDir, 'articulo-size.pdf');

    await convertToPdf(doc, outputPath);

    const pdfFile = Bun.file(outputPath);
    const size = (await pdfFile.stat())?.size ?? 0;
    expect(size).toBeGreaterThan(5 * 1024);
  });

  test.skipIf(!toolsAvailable)('un documento scrbook con tabla de contenidos genera PDF válido', async () => {
    const doc: ExportDocument = {
      filePath: join(outputDir, 'coleccion.md'),
      relativePath: 'coleccion.md',
      type: 'collection',
      body: '# Capítulo uno\n\nContenido del primer capítulo.\n\n\\newpage\n\n# Capítulo dos\n\nContenido del segundo capítulo.\n',
      metadata: {
        title: 'Colección de prueba',
        author: ['Autora Test'],
        date: '2025-01-01',
        lang: 'es',
        documentclass: 'scrbook',
        toc: true,
      },
    };
    const outputPath = join(outputDir, 'coleccion.pdf');

    await convertToPdf(doc, outputPath);

    const pdfFile = Bun.file(outputPath);
    const buffer = await pdfFile.arrayBuffer();
    const header = new TextDecoder().decode(new Uint8Array(buffer, 0, 5));
    expect(header).toBe('%PDF-');
  });
});
