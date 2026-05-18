import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from '../orchestrator.js';

const FIXTURES = join(import.meta.dir, 'fixtures');

/** Crea un directorio temporal de salida para cada suite. */
function makeOutput(): string {
  return mkdtempSync(join(tmpdir(), 'iteraciones-test-'));
}

// ---------------------------------------------------------------------------
// Fixture: minimal — un documento type:file, sin config
// ---------------------------------------------------------------------------

describe('fixture: minimal', () => {
  let outputDir: string;

  beforeAll(async () => {
    outputDir = makeOutput();
    await build(join(FIXTURES, 'minimal'), { outputDir, noCache: true, noTailwind: true });
  });

  afterAll(() => {
    if (outputDir) rmSync(outputDir, { recursive: true, force: true });
  });

  test('genera index.html', () => {
    expect(existsSync(join(outputDir, 'index.html'))).toBe(true);
  });

  test('el HTML contiene el título del documento', () => {
    const html = readFileSync(join(outputDir, 'index.html'), 'utf8');
    expect(html).toContain('Página de inicio');
  });

  test('el HTML contiene el cuerpo del documento', () => {
    const html = readFileSync(join(outputDir, 'index.html'), 'utf8');
    expect(html).toContain('Bienvenido al sitio de prueba mínimo');
  });
});

// ---------------------------------------------------------------------------
// Fixture: with-author — file + author; verifica authorDocumentIndex
// ---------------------------------------------------------------------------

describe('fixture: with-author', () => {
  let outputDir: string;

  beforeAll(async () => {
    outputDir = makeOutput();
    await build(join(FIXTURES, 'with-author'), { outputDir, noCache: true, noTailwind: true });
  });

  afterAll(() => {
    if (outputDir) rmSync(outputDir, { recursive: true, force: true });
  });

  test('genera index.html', () => {
    expect(existsSync(join(outputDir, 'index.html'))).toBe(true);
  });

  test('genera personas/sofia.html', () => {
    expect(existsSync(join(outputDir, 'personas/sofia.html'))).toBe(true);
  });

  test('el HTML del artículo contiene el nombre del autor', () => {
    const html = readFileSync(join(outputDir, 'index.html'), 'utf8');
    expect(html).toContain('Sofía García');
  });

  test('el HTML del autor contiene su bio', () => {
    const html = readFileSync(join(outputDir, 'personas/sofia.html'), 'utf8');
    expect(html).toContain('Investigadora y escritora');
  });
});

// ---------------------------------------------------------------------------
// Fixture: with-collection — collection con items: resolvibles
// ---------------------------------------------------------------------------

describe('fixture: with-collection', () => {
  let outputDir: string;

  beforeAll(async () => {
    outputDir = makeOutput();
    await build(join(FIXTURES, 'with-collection'), { outputDir, noCache: true, noTailwind: true });
  });

  afterAll(() => {
    if (outputDir) rmSync(outputDir, { recursive: true, force: true });
  });

  test('genera seleccion.html', () => {
    expect(existsSync(join(outputDir, 'seleccion.html'))).toBe(true);
  });

  test('genera articulos/uno.html', () => {
    expect(existsSync(join(outputDir, 'articulos/uno.html'))).toBe(true);
  });

  test('genera articulos/dos.html', () => {
    expect(existsSync(join(outputDir, 'articulos/dos.html'))).toBe(true);
  });

  test('el HTML de la colección contiene los títulos de los items', () => {
    const html = readFileSync(join(outputDir, 'seleccion.html'), 'utf8');
    expect(html).toContain('Primer artículo');
    expect(html).toContain('Segundo artículo');
  });
});

// ---------------------------------------------------------------------------
// Fixture: with-blocks — bloque card inyectado en región sidebar-primary
// ---------------------------------------------------------------------------

describe('fixture: with-blocks', () => {
  let outputDir: string;

  beforeAll(async () => {
    outputDir = makeOutput();
    await build(join(FIXTURES, 'with-blocks'), { outputDir, noCache: true, noTailwind: true });
  });

  afterAll(() => {
    if (outputDir) rmSync(outputDir, { recursive: true, force: true });
  });

  test('genera index.html (el bloque no genera archivo propio)', () => {
    expect(existsSync(join(outputDir, 'index.html'))).toBe(true);
  });

  test('el bloque no genera su propio archivo HTML', () => {
    expect(existsSync(join(outputDir, 'widgets/lateral.html'))).toBe(false);
  });

  test('el HTML de index contiene el contenido del bloque', () => {
    const html = readFileSync(join(outputDir, 'index.html'), 'utf8');
    expect(html).toContain('Widget lateral');
  });
});

// ---------------------------------------------------------------------------
// Fixture: with-pagination — list con listItemsLimit: 2 y 5 docs
// ---------------------------------------------------------------------------

describe('fixture: with-pagination', () => {
  let outputDir: string;

  beforeAll(async () => {
    outputDir = makeOutput();
    await build(join(FIXTURES, 'with-pagination'), { outputDir, noCache: true, noTailwind: true });
  });

  afterAll(() => {
    if (outputDir) rmSync(outputDir, { recursive: true, force: true });
  });

  test('genera lista.html (página 1)', () => {
    expect(existsSync(join(outputDir, 'lista.html'))).toBe(true);
  });

  test('genera lista/2.html (página 2)', () => {
    expect(existsSync(join(outputDir, 'lista/2.html'))).toBe(true);
  });

  test('genera lista/3.html (página 3)', () => {
    expect(existsSync(join(outputDir, 'lista/3.html'))).toBe(true);
  });

  test('no genera lista/4.html (solo 5 docs / 2 por página = 3 páginas)', () => {
    expect(existsSync(join(outputDir, 'lista/4.html'))).toBe(false);
  });

  test('genera los 5 archivos de notas', () => {
    for (let i = 1; i <= 5; i++) {
      expect(existsSync(join(outputDir, `notas/nota${i}.html`))).toBe(true);
    }
  });

  test('el HTML de la página 1 contiene el título del doc list', () => {
    const html = readFileSync(join(outputDir, 'lista.html'), 'utf8');
    expect(html).toContain('Todas las notas');
  });
});
