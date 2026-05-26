import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from '../orchestrator.js';
import { isPandocAvailable } from './helpers/tools.js';

const pandocAvailable = await isPandocAvailable();

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

// ---------------------------------------------------------------------------
// Fixture: with-event-and-index-types — event, events, authors, menu, card
// ---------------------------------------------------------------------------

describe('fixture: with-event-and-index-types', () => {
  let outputDir: string;

  beforeAll(async () => {
    outputDir = makeOutput();
    await build(join(FIXTURES, 'with-event-and-index-types'), { outputDir, noCache: true, noTailwind: true });
  });

  afterAll(() => {
    if (outputDir) rmSync(outputDir, { recursive: true, force: true });
  });

  test('genera eventos/taller.html (type: event)', () => {
    expect(existsSync(join(outputDir, 'eventos/taller.html'))).toBe(true);
  });

  test('genera eventos/index.html (type: events)', () => {
    expect(existsSync(join(outputDir, 'eventos/index.html'))).toBe(true);
  });

  test('genera personas/ana.html (type: author)', () => {
    expect(existsSync(join(outputDir, 'personas/ana.html'))).toBe(true);
  });

  test('genera personas/index.html (type: authors)', () => {
    expect(existsSync(join(outputDir, 'personas/index.html'))).toBe(true);
  });

  test('genera menu.html (type: menu, sin block: true)', () => {
    expect(existsSync(join(outputDir, 'menu.html'))).toBe(true);
  });

  test('menu.html contiene los labels del nav del frontmatter', () => {
    const html = readFileSync(join(outputDir, 'menu.html'), 'utf8');
    expect(html).toContain('Inicio');
    expect(html).toContain('Eventos');
    expect(html).toContain('Personas');
  });

  test('convocatoria.html no existe (type: card, block: true)', () => {
    expect(existsSync(join(outputDir, 'convocatoria.html'))).toBe(false);
  });

  test('events index lista el título del evento', () => {
    const html = readFileSync(join(outputDir, 'eventos/index.html'), 'utf8');
    expect(html).toContain('Taller de tipografía práctica');
  });

  test('authors index lista el nombre del autor', () => {
    const html = readFileSync(join(outputDir, 'personas/index.html'), 'utf8');
    expect(html).toContain('Ana Lucía Torres');
  });

  test('el HTML del evento contiene el título', () => {
    const html = readFileSync(join(outputDir, 'eventos/taller.html'), 'utf8');
    expect(html).toContain('Taller de tipografía práctica');
  });

  test('el HTML del autor contiene su bio', () => {
    const html = readFileSync(join(outputDir, 'personas/ana.html'), 'utf8');
    expect(html).toContain('Investigadora especializada');
  });
});

// ---------------------------------------------------------------------------
// Caché — segunda build con noCache: false produce output idéntico
// ---------------------------------------------------------------------------

describe('caché: segunda build produce output idéntico al primero', () => {
  let tmpCwd: string;
  let outputDir1: string;
  let outputDir2: string;

  beforeAll(async () => {
    // Copiar fixture a directorio temporal para no contaminar el fixture con archivos de caché
    tmpCwd = mkdtempSync(join(tmpdir(), 'iteraciones-cache-test-'));
    cpSync(join(FIXTURES, 'with-collection'), tmpCwd, { recursive: true });

    outputDir1 = makeOutput();
    outputDir2 = makeOutput();

    // Primera build (caché fría) y segunda build (caché caliente)
    await build(tmpCwd, { outputDir: outputDir1, noCache: false, noTailwind: true });
    await build(tmpCwd, { outputDir: outputDir2, noCache: false, noTailwind: true });
  });

  afterAll(() => {
    if (tmpCwd) rmSync(tmpCwd, { recursive: true, force: true });
    if (outputDir1) rmSync(outputDir1, { recursive: true, force: true });
    if (outputDir2) rmSync(outputDir2, { recursive: true, force: true });
  });

  test('seleccion.html es idéntico en build fría y caliente', () => {
    const html1 = readFileSync(join(outputDir1, 'seleccion.html'), 'utf8');
    const html2 = readFileSync(join(outputDir2, 'seleccion.html'), 'utf8');
    expect(html1).toBe(html2);
  });

  test('articulos/uno.html es idéntico en build fría y caliente', () => {
    const html1 = readFileSync(join(outputDir1, 'articulos/uno.html'), 'utf8');
    const html2 = readFileSync(join(outputDir2, 'articulos/uno.html'), 'utf8');
    expect(html1).toBe(html2);
  });

  test('articulos/dos.html es idéntico en build fría y caliente', () => {
    const html1 = readFileSync(join(outputDir1, 'articulos/dos.html'), 'utf8');
    const html2 = readFileSync(join(outputDir2, 'articulos/dos.html'), 'utf8');
    expect(html1).toBe(html2);
  });

  test('la build fría escribe entradas en la caché de render', () => {
    // Prueba indirecta de que la caché fue usada en la segunda build:
    // la caché de render debe existir y tener al menos un subdirectorio (prefijo hex)
    // tras la primera build, lo que confirma que las entradas fueron escritas.
    const renderCacheDir = join(tmpCwd, '.iteraciones', 'cache', 'render');
    expect(existsSync(renderCacheDir)).toBe(true);
    const prefixDirs = readdirSync(renderCacheDir);
    expect(prefixDirs.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Build incremental con export — solo los archivos modificados deben reescribirse
// ---------------------------------------------------------------------------

if (pandocAvailable) {
  describe('build incremental con export usa solo docs afectados', () => {
    let tmpCwd: string;
    let outputDir: string;
    let epubATime: number;
    let epubBTime: number;

    beforeAll(async () => {
      tmpCwd = mkdtempSync(join(tmpdir(), 'iteraciones-incremental-export-'));
      outputDir = mkdtempSync(join(tmpdir(), 'iteraciones-incremental-output-'));

      writeFileSync(
        join(tmpCwd, '_iteraciones.yaml'),
        `site:
  theme: default
  export:
    formats:
      - epub
`,
        'utf8',
      );

      writeFileSync(
        join(tmpCwd, 'a.md'),
        `---
title: Documento A
author: ['Test']
keywords: []
region: ""
block: false
draft: false
items: []
---

Contenido inicial A.
`,
        'utf8',
      );

      writeFileSync(
        join(tmpCwd, 'b.md'),
        `---
title: Documento B
author: ['Test']
keywords: []
region: ""
block: false
draft: false
items: []
---

Contenido inicial B.
`,
        'utf8',
      );

      await build(tmpCwd, { outputDir, noCache: false, noTailwind: true });

      epubATime = statSync(join(outputDir, 'a.epub')).mtime.getTime();
      epubBTime = statSync(join(outputDir, 'b.epub')).mtime.getTime();
    });

    afterAll(() => {
      if (tmpCwd) rmSync(tmpCwd, { recursive: true, force: true });
      if (outputDir) rmSync(outputDir, { recursive: true, force: true });
    });

    test('solo el EPUB del documento modificado se reescribe en rebuild incremental', async () => {
      writeFileSync(
        join(tmpCwd, 'a.md'),
        `---
title: Documento A
author: ['Test']
keywords: []
region: ""
block: false
draft: false
items: []
---

Contenido actualizado A.
`,
        'utf8',
      );

      await build(tmpCwd, {
        outputDir,
        noCache: false,
        noTailwind: true,
        incremental: true,
        changedPaths: new Set(['a.md']),
      });

      const epubANewTime = statSync(join(outputDir, 'a.epub')).mtime.getTime();
      const epubBNewTime = statSync(join(outputDir, 'b.epub')).mtime.getTime();

      expect(epubANewTime).toBeGreaterThan(epubATime);
      expect(epubBNewTime).toBe(epubBTime);
    });
  });
}
