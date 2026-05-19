/**
 * T3 — export-pdf.test.ts
 *
 * Test de integración: verifica que convertToPdf produce un archivo PDF válido.
 * Se omite automáticamente si pandoc o xelatex no están disponibles en el entorno.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { convertToPdf } from '../../services/pandoc-exporter.js';
import { run } from '../../services/run.js';
import type { ExportDocument } from '../export/types.js';

// ---------------------------------------------------------------------------
// Helpers: verificar disponibilidad de herramientas
// ---------------------------------------------------------------------------

async function isPandocAvailable(): Promise<boolean> {
  try {
    const result = await run('pandoc', ['--version']);
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

async function isXelatexAvailable(): Promise<boolean> {
  try {
    const result = await run('xelatex', ['--version']);
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
    body: '## Introducción\n\nEste es un documento de prueba para verificar la exportación PDF.\n',
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

describe('convertToPdf — integración', () => {
  let outputDir: string;
  let toolsAvailable: boolean;

  beforeAll(async () => {
    outputDir = mkdtempSync(join(tmpdir(), 'iteraciones-pdf-test-'));
    const [pandoc, xelatex] = await Promise.all([isPandocAvailable(), isXelatexAvailable()]);
    toolsAvailable = pandoc && xelatex;
    if (!toolsAvailable) {
      console.log('  ⚠ pandoc o xelatex no disponibles — tests de PDF omitidos');
    }
  });

  afterAll(() => {
    if (outputDir) rmSync(outputDir, { recursive: true, force: true });
  });

  test('el PDF producido comienza con el header %PDF-', async () => {
    if (!toolsAvailable) return;

    const doc = makeMinimalExportDoc(outputDir);
    const outputPath = join(outputDir, 'articulo.pdf');

    await convertToPdf(doc, outputPath, 'xelatex');

    const pdfFile = Bun.file(outputPath);
    expect(await pdfFile.exists()).toBe(true);

    // Verificar la firma magic de PDF: los primeros 5 bytes son '%PDF-'
    const buffer = await pdfFile.arrayBuffer();
    const header = new TextDecoder().decode(new Uint8Array(buffer, 0, 5));
    expect(header).toBe('%PDF-');
  });

  test('el archivo PDF tiene un tamaño razonable (> 5KB)', async () => {
    if (!toolsAvailable) return;

    const doc = makeMinimalExportDoc(outputDir);
    const outputPath = join(outputDir, 'articulo-size.pdf');

    await convertToPdf(doc, outputPath, 'xelatex');

    const pdfFile = Bun.file(outputPath);
    const size = (await pdfFile.stat())?.size ?? 0;
    expect(size).toBeGreaterThan(5 * 1024);
  });

  test('un documento scrbook con tabla de contenidos genera PDF válido', async () => {
    if (!toolsAvailable) return;

    const doc: ExportDocument = {
      filePath: join(outputDir, 'coleccion.md'),
      relativePath: 'coleccion.md',
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

    await convertToPdf(doc, outputPath, 'xelatex');

    const pdfFile = Bun.file(outputPath);
    const buffer = await pdfFile.arrayBuffer();
    const header = new TextDecoder().decode(new Uint8Array(buffer, 0, 5));
    expect(header).toBe('%PDF-');
  });
});
