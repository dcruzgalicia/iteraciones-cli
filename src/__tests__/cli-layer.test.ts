import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CommanderError } from 'commander';
import { runBuild, runClean, runDoctor, runFilters, runInfo, runInit, runNew, runValidate } from '../cli/dispatcher.js';
import { buildProgram } from '../cli/parser.js';
import { DEFAULT_HTML_BLOCKS } from '../config/site-config.js';
import { accentOverrideBlock } from '../lib/accent-palettes.js';
import { initTestProject } from './helpers.js';

/**
 * Crea un directorio temporal y ejecuta la función de test. Lo limpia al final.
 */
async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'iteraciones-cli-test-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Restaura exitCode y el spy de stderr después de cada test que los toque.
 */
function resetExitCode() {
  process.exitCode = 0;
}

function spyStderr() {
  const s = spyOn(process.stderr, 'write');
  return s;
}

describe('parser (errores de commander en español)', () => {
  /** Ejecuta el parser con argv dados, captura stderr y el exit code del error. */
  async function parseUsageError(argv: string[]): Promise<{ output: string; exitCode: number }> {
    const stderrSpy = spyStderr();
    let output = '';
    let exitCode = 0;
    try {
      await buildProgram().parseAsync(['bun', 'bin.ts', ...argv]);
    } catch (err) {
      exitCode = err instanceof CommanderError ? err.exitCode : 1;
    } finally {
      output = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
      stderrSpy.mockRestore();
    }
    return { output, exitCode };
  }

  it('comando desconocido se reporta en español', async () => {
    const { output, exitCode } = await parseUsageError(['comando-inexistente']);
    expect(output).toContain("error: comando desconocido 'comando-inexistente'");
    expect(exitCode).toBe(1);
  });

  it('sugiere comandos cercanos en español', async () => {
    const { output } = await parseUsageError(['bui']);
    expect(output).toContain("error: comando desconocido 'bui'");
    expect(output).toContain('(¿Quisiste decir build?)');
  });

  it('opción sin argumento se reporta en español', async () => {
    const { output, exitCode } = await parseUsageError(['validate', '--project-root']);
    expect(output).toContain("error: falta el argumento de la opción '--project-root <path>'");
    expect(exitCode).toBe(1);
  });

  it('argumento requerido faltante se reporta en español', async () => {
    const { output, exitCode } = await parseUsageError(['new']);
    expect(output).toContain("error: falta el argumento requerido 'path'");
    expect(exitCode).toBe(1);
  });

  it('la bandera eliminada doctor --fix se reporta como opción desconocida', async () => {
    const { output, exitCode } = await parseUsageError(['doctor', '--fix']);
    expect(output).toContain("error: opción desconocida '--fix'");
    expect(exitCode).toBe(1);
  });
});

describe('parser (errores de flags)', () => {
  afterEach(resetExitCode);

  /** Ejecuta el parser con argv dados y captura stderr. */
  async function parseWithStderr(argv: string[]): Promise<string> {
    const stderrSpy = spyStderr();
    let output = '';
    try {
      await buildProgram().parseAsync(['bun', 'bin.ts', ...argv]);
    } finally {
      output = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
      stderrSpy.mockRestore();
    }
    return output;
  }

  it('--concurrency 0 produce mensaje amigable sin stack trace', async () => {
    process.exitCode = 0;
    const output = await parseWithStderr(['build', '--concurrency', '0']);
    expect(output).toContain('✖');
    expect(output).toContain('--concurrency debe ser un entero positivo (recibido: "0")');
    expect(output).not.toContain('at <anonymous>');
    expect(output).not.toContain('.ts:');
    expect(process.exitCode).toBe(1);
  });

  it('--concurrency abc produce mensaje amigable sin stack trace', async () => {
    process.exitCode = 0;
    const output = await parseWithStderr(['build', '--concurrency', 'abc']);
    expect(output).toContain('--concurrency debe ser un entero positivo (recibido: "abc")');
    expect(output).not.toContain('at <anonymous>');
    expect(process.exitCode).toBe(1);
  });

  it('--output fuera del proyecto produce mensaje amigable sin stack trace', async () => {
    process.exitCode = 0;
    const output = await parseWithStderr(['build', '--output', '../fuera']);
    expect(output).toContain('--output no puede apuntar fuera del proyecto');
    expect(output).not.toContain('at <anonymous>');
    expect(process.exitCode).toBe(1);
  });
});

describe('runBuild', () => {
  afterEach(resetExitCode);

  it('termina con exit 0 en un proyecto vacío (sin documentos)', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      process.exitCode = 0;
      await runBuild(dir);
      expect(process.exitCode).toBe(0);
    });
  });

  it('proyecto vacío reporta 0 formatos sin "(reutilizado)" y avisa en stderr', async () => {
    await withTempDir(async (dir) => {
      const stdoutSpy = spyOn(process.stdout, 'write');
      const stderrSpy = spyStderr();
      let out = '';
      let _err = '';
      try {
        process.exitCode = 0;
        await runBuild(dir);
      } finally {
        out = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
        _err = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
        stdoutSpy.mockRestore();
        stderrSpy.mockRestore();
      }
      expect(process.exitCode).toBe(0);
      expect(out).toMatch(/Formatos generados\s+0/);
      expect(out).not.toContain('reutilizado');
      // El aviso es un warning diferido al bloque Advertencias del resumen
      expect(out).toContain('⚠ [build] No se encontraron documentos Markdown en el proyecto.');
    });
  });

  it('sin index.md la tarjeta identidad no enlaza a un home inexistente', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir); // test.md en la raíz, sin index.md
      process.exitCode = 0;
      await runBuild(dir);
      expect(process.exitCode).toBe(0);
      const html = await Bun.file(join(dir, 'dist', 'files', 'test-document.html')).text();
      expect(html).not.toContain('<a href="./index.html"');
      // La tarjeta se renderiza como div (sin enlace)
      expect(html).toContain('Tarjeta identidad');
    });
  });

  it('con index.md la tarjeta identidad enlaza explícitamente a index.html', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(join(dir, 'index.md'), '---\ntitle: Inicio\n---\n\n# Bienvenida\n\nContenido.\n', 'utf8');
      process.exitCode = 0;
      await runBuild(dir);
      expect(process.exitCode).toBe(0);
      const html = await Bun.file(join(dir, 'dist', 'files', 'test-document.html')).text();
      expect(html).toContain('href="./index.html"');
      expect(await Bun.file(join(dir, 'dist', 'files', 'index.html')).exists()).toBe(true);
    });
  });

  it('el enlace al home desde un subdirectorio usa la ruta relativa unificada', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      const { mkdir } = await import('node:fs/promises');
      await mkdir(join(dir, 'posts'), { recursive: true });
      await writeFile(join(dir, 'index.md'), '---\ntitle: Inicio\n---\n\n# Bienvenida\n\nContenido.\n', 'utf8');
      await writeFile(join(dir, 'posts', 'articulo.md'), '---\ntitle: Artículo\n---\n\nContenido.\n', 'utf8');
      process.exitCode = 0;
      await runBuild(dir);
      expect(process.exitCode).toBe(0);
      const html = await Bun.file(join(dir, 'dist', 'files', 'posts', 'articulo.html')).text();
      expect(html).toContain('href="./../index.html"');
    });
  });

  it('build cacheado mantiene "(reutilizado)" en el resumen', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      process.exitCode = 0;
      await runBuild(dir);
      const stdoutSpy = spyOn(process.stdout, 'write');
      let out = '';
      try {
        process.exitCode = 0;
        await runBuild(dir);
      } finally {
        out = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
        stdoutSpy.mockRestore();
      }
      expect(process.exitCode).toBe(0);
      expect(out).toContain('(reutilizado)');
    });
  });

  it('termina con exit 1 con --concurrency inválido', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      process.exitCode = 0;
      await runBuild(dir, { concurrency: 0 });
      expect(process.exitCode).toBe(1);
    });
  });

  it('termina con exit 1 con --output fuera del proyecto', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      process.exitCode = 0;
      await runBuild(dir, { outputDir: '../fuera' });
      expect(process.exitCode).toBe(1);
    });
  });

  it('resuelve --output relativo contra la raíz del proyecto', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      process.exitCode = 0;
      await runBuild(dir, { outputDir: 'salida' });
      expect(process.exitCode).toBe(0);
      expect(await Bun.file(join(dir, 'salida', 'test-document.html')).exists()).toBe(true);
      // No escribe en el cwd del proceso
      expect(await Bun.file(join(tmpdir(), 'salida')).exists()).toBe(false);
    });
  });

  it('rechaza --concurrency no entero con mensaje en stderr', async () => {
    const stderrSpy = spyStderr();
    let output = '';
    try {
      await withTempDir(async (dir) => {
        await initTestProject(dir);
        process.exitCode = 0;
        await runBuild(dir, { concurrency: 0 });
      });
    } finally {
      output = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
      stderrSpy.mockRestore();
    }
    expect(output).toContain('concurrency');
  });

  it('frontmatter YAML inválido se reporta con contexto [build]', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(join(dir, 'roto.md'), '---\ntitle: "Roto"\ninvalid: [unclosed\n---\n\nContenido.\n', 'utf8');
      const stderrSpy = spyStderr();
      let output = '';
      try {
        process.exitCode = 0;
        await runBuild(dir);
      } finally {
        output = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
        stderrSpy.mockRestore();
      }
      expect(output).toContain('✖ [build] frontmatter YAML inválido en 1 documento:');
      expect(output).toContain('roto.md:');
      expect(process.exitCode).toBe(1);
    });
  });

  it('un page-number inválido se reporta como error de config con la ruta del campo (sin stack trace)', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(join(dir, 'iteraciones.config.yaml'), 'lang: es-MX\nformat:\n  pdf:\n    generate: true\n    page-number: raro\n', 'utf8');
      const stderrSpy = spyStderr();
      let output = '';
      try {
        process.exitCode = 0;
        await runBuild(dir);
      } finally {
        output = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
        stderrSpy.mockRestore();
      }
      expect(output).toContain('✖ [config] format.pdf.page-number');
      expect(output).not.toContain('at <anonymous>');
      expect(output).not.toContain('.ts:');
      expect(process.exitCode).toBe(1);
    });
  });

  it('un cambio de bibliografía regenera las exportaciones sin re-renderizar los ASTs', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(join(dir, 'iteraciones.config.yaml'), 'lang: es-MX\nbibliography: refs/libro.bib\n', 'utf8');
      const { mkdir } = await import('node:fs/promises');
      await mkdir(join(dir, 'refs'), { recursive: true });
      await writeFile(
        join(dir, 'refs', 'libro.bib'),
        '@book{ejemplo2024,\n  title = {Título original},\n  author = {Autor},\n  year = {2024},\n}\n',
        'utf8',
      );
      await writeFile(join(dir, 'test.md'), '---\ntitle: Test Document\ndate: 2026-01-01\n---\n\nSegún @ejemplo2024, las citas funcionan.\n', 'utf8');
      process.exitCode = 0;
      await runBuild(dir);
      expect(process.exitCode).toBe(0);
      const { readdirSync } = await import('node:fs');
      const astFiles = readdirSync(join(dir, '.iteraciones', 'ast'));
      expect(astFiles.length).toBeGreaterThan(0);
      const astBefore = await Bun.file(join(dir, '.iteraciones', 'ast', astFiles[0] ?? '')).text();
      const htmlBefore = await Bun.file(join(dir, 'dist', 'files', 'test-document.html')).text();
      expect(htmlBefore).toContain('Título original');

      // Cambiar la bibliografía: las exportaciones se regeneran, el AST no
      await writeFile(
        join(dir, 'refs', 'libro.bib'),
        '@book{ejemplo2024,\n  title = {Título nuevo},\n  author = {Autor},\n  year = {2024},\n}\n',
        'utf8',
      );
      process.exitCode = 0;
      await runBuild(dir);
      expect(process.exitCode).toBe(0);
      const astAfter = await Bun.file(join(dir, '.iteraciones', 'ast', astFiles[0] ?? '')).text();
      expect(astAfter).toBe(astBefore);
      const htmlAfter = await Bun.file(join(dir, 'dist', 'files', 'test-document.html')).text();
      expect(htmlAfter).toContain('Título nuevo');
    });
  });

  it('el EPUB generado incluye título, autor e idioma en sus metadatos', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(join(dir, 'iteraciones.config.yaml'), ['lang: es-MX', 'format:', '  epub:', '    generate: true'].join('\n'), 'utf8');
      await writeFile(
        join(dir, 'test.md'),
        '---\ntitle: Test Document\nauthor: María Pérez\ndate: 2026-01-01\n---\n\nContenido de prueba.\n',
        'utf8',
      );
      process.exitCode = 0;
      await runBuild(dir);
      expect(process.exitCode).toBe(0);

      // El EPUB es un zip: desempaquetar content.opf y verificar dc:title,
      // dc:creator, dc:date y dc:language (regresión: salía sin metadatos,
      // "UNTITLED"). El nombre usa el slug title-por-author: se busca el .epub.
      const [epubPath] = [...new Bun.Glob('dist/files/*.epub').scanSync({ cwd: dir })];
      expect(epubPath).toBeDefined();
      const proc = Bun.spawn(['unzip', '-p', join(dir, epubPath ?? ''), 'EPUB/content.opf'], { stdout: 'pipe', stderr: 'pipe' });
      const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
      expect(code).toBe(0);
      expect(stderr).toBe('');
      expect(stdout).toContain('Test Document</dc:title>');
      expect(stdout).toContain('María Pérez</dc:creator>');
      expect(stdout).toContain('>es-MX</dc:language>');
      expect(stdout).toContain('>2026-01-01</dc:date>');
    });
  });

  it('un documento sin cuerpo después del frontmatter aborta el build con la ruta del archivo', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(join(dir, 'vacio.md'), '---\ntitle: Vacío\n---\n', 'utf8');
      const stderrSpy = spyStderr();
      let output = '';
      try {
        process.exitCode = 0;
        await runBuild(dir);
      } finally {
        output = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
        stderrSpy.mockRestore();
      }
      expect(output).toContain('✖ [build]');
      expect(output).toContain('vacio.md');
      expect(output).toContain('no tiene contenido después del frontmatter');
      expect(process.exitCode).toBe(1);
    });
  });

  it('el siguiente build reintenta el documento que falló (no envenena la caché)', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(join(dir, 'vacio.md'), '---\ntitle: Vacío\n---\n', 'utf8');
      process.exitCode = 0;
      await runBuild(dir);
      expect(process.exitCode).toBe(1);

      // Arreglar el documento y reconstruir: debe reprocesarlo, no reutilizarlo
      await writeFile(join(dir, 'vacio.md'), '---\ntitle: Vacío\n---\n\nAhora sí tiene contenido.\n', 'utf8');
      const stdoutSpy = spyOn(process.stdout, 'write');
      let output = '';
      try {
        process.exitCode = 0;
        await runBuild(dir);
      } finally {
        output = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
        stdoutSpy.mockRestore();
      }
      expect(process.exitCode).toBe(0);
      expect(output).toContain('Documentos procesados');
      expect(output).not.toContain('Sin cambios (reutilizado)');
    });
  });

  it('un error de pandoc reporta la ruta del documento una sola vez', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(join(dir, 'iteraciones.config.yaml'), 'lang: es-MX\nlua-filters: [filters/roto.lua]\n', 'utf8');
      const { mkdir } = await import('node:fs/promises');
      await mkdir(join(dir, 'filters'), { recursive: true });
      await writeFile(join(dir, 'filters', 'roto.lua'), 'function ) sintaxis inválida\n', 'utf8');
      const stderrSpy = spyStderr();
      let output = '';
      try {
        process.exitCode = 0;
        await runBuild(dir);
      } finally {
        output = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
        stderrSpy.mockRestore();
      }
      expect(output).toContain('✖ pandoc falló al convertir el documento en "');
      expect(output).toContain('test.md');
      // La ruta aparece una sola vez: ni duplicada ni en el mensaje previo a "en"
      expect(output).not.toContain('pandoc falló al convertir test.md');
      expect(process.exitCode).toBe(1);
    });
  });

  it('el CSS ensamblado del acento se genera sin invocar Tailwind ni escanear el proyecto', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      process.exitCode = 0;
      await runBuild(dir);
      const cssPath = join(dir, 'dist', 'files', 'css', 'styles.css');
      const css = await Bun.file(cssPath).text();
      // El CSS es el base embarcado + el override del acento por defecto (lime)
      const base = await Bun.file(join(import.meta.dir, '../lib/resources/css/base.css')).text();
      const expected = `${base}\n${accentOverrideBlock('lime')}`;
      expect(css).toBe(expected);
      expect(css).toContain('prose-xl');

      // Archivos .md dentro de dist/ y .iteraciones/ no afectan el CSS
      const { mkdir } = await import('node:fs/promises');
      await mkdir(join(dir, 'dist', 'files'), { recursive: true });
      await mkdir(join(dir, '.iteraciones', 'changes'), { recursive: true });
      await writeFile(join(dir, 'dist', 'files', 'basura.md'), 'bg-fuchsia-700\n', 'utf8');
      await writeFile(join(dir, '.iteraciones', 'changes', 'basura.md'), 'bg-indigo-700\n', 'utf8');

      // Modificar el documento para forzar un build con trabajo
      await writeFile(
        join(dir, 'test.md'),
        '---\ntitle: Test Document\ndate: 2026-01-01\n---\n\n<div class="bg-teal-300">x</div>\n\nNuevo contenido.\n',
        'utf8',
      );
      process.exitCode = 0;
      await runBuild(dir);
      const css2 = await Bun.file(cssPath).text();
      expect(css2).toBe(expected);
      expect(css2).not.toContain('bg-fuchsia-700');
      expect(css2).not.toContain('bg-indigo-700');
    });
  });

  it('títulos con comillas, dos puntos y saltos de línea no rompen el HTML', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      // El YAML de doble comilla interpreta \n como salto de línea real en el valor
      await writeFile(join(dir, 'test.md'), '---\ntitle: "Título: \\"especial\\" y más\\ncon salto"\ndate: 2026-01-01\n---\n\nContenido.\n', 'utf8');
      process.exitCode = 0;
      await runBuild(dir);
      expect(process.exitCode).toBe(0);
      // El slug deriva del título: titulo-especial-y-mas-con-salto
      const html = await Bun.file(join(dir, 'dist', 'files', 'titulo-especial-y-mas-con-salto.html')).text();
      expect(html).toContain('"especial"');
      expect(html).toContain('con salto');
      expect(html).toContain('<title>Título: "especial" y más con salto · Test</title>');
    });
  });

  it('el índice no enlaza a referencias y la tarjeta conserva su chip', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(join(dir, 'iteraciones.config.yaml'), 'lang: es-MX\ntoc: true\nformat:\n  latex: true\n', 'utf8');
      await writeFile(join(dir, 'bibliography.bib'), '@book{key1, author = {García, Lucía}, title = {Libro}, year = {2024}}\n', 'utf8');
      await writeFile(join(dir, 'test.md'), '---\ntitle: Test Document\ndate: 2026-01-01\n---\n\n# Sección\n\nCita [@key1].\n', 'utf8');
      process.exitCode = 0;
      await runBuild(dir);
      expect(process.exitCode).toBe(0);
      const html = await Bun.file(join(dir, 'dist', 'files', 'test-document.html')).text();
      // El bloque del índice no contiene el enlace a referencias
      const indiceStart = html.indexOf('block:indice');
      const indiceEnd = html.indexOf('block:referencias');
      const indiceBlock = html.slice(indiceStart, indiceEnd);
      expect(indiceBlock).not.toContain('href="#referencias"');
      // La tarjeta de referencias conserva su chip y sus entradas
      expect(html).toContain('id="referencias"');
      expect(html).toContain('>Referencias</h2>');
      expect(html).toContain('csl-entry');
      // Las citas del texto siguen enlazando a sus entradas (link-citations)
      expect(html).toContain('href="#ref-key1"');
    });
  });

  it('las tarjetas de formatos y referencias se insertan fuera de la tarjeta de contenido (regresión #1445)', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(join(dir, 'iteraciones.config.yaml'), 'lang: es-MX\nformat:\n  latex: true\n', 'utf8');
      await writeFile(join(dir, 'bibliography.bib'), '@book{key1, author = {García, Lucía}, title = {Libro}, year = {2024}}\n', 'utf8');
      await writeFile(join(dir, 'test.md'), '---\ntitle: Test Document\ndate: 2026-01-01\n---\n\n# Sección\n\nCita [@key1].\n', 'utf8');
      process.exitCode = 0;
      await runBuild(dir);
      expect(process.exitCode).toBe(0);
      const html = await Bun.file(join(dir, 'dist', 'files', 'test-document.html')).text();
      // La tarjeta Formatos va después de la tarjeta de contenido
      expect(html.indexOf('>Formatos</h2>')).toBeGreaterThan(html.indexOf('<article'));
      // Las referencias viven en su propia tarjeta, fuera del article
      expect(html.indexOf('id="referencias"')).toBeGreaterThan(html.indexOf('</article>'));
    });
  });

  it('el HTML incluye el botón flotante para volver al principio y el CSS su animación', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      process.exitCode = 0;
      await runBuild(dir);
      expect(process.exitCode).toBe(0);
      const html = await Bun.file(join(dir, 'dist', 'files', 'test-document.html')).text();
      // El ancla y el botón existen en cada página
      expect(html).toContain('<body id="top"');
      expect(html).toContain('aria-label="Volver al principio"');
      expect(html).toContain('scroll-reveal');
      // Posición centrada inferior, tamaño y estilo tipo chip del botón
      expect(html).toContain('left-1/2 -translate-x-1/2');
      expect(html).toContain('size-12');
      expect(html).toContain('bg-accent-500/15');
      expect(html).toContain('text-accent-600 dark:text-accent-400');
      // Padding inferior del main: el botón no tapa el contenido al final
      expect(html).toContain('pt-8 pb-24');
      // El botón no es un bloque del masonry (fuera del sistema de bloques)
      expect(html).not.toContain('block:volver');
      // El CSS precompilado incluye la animación scroll-driven
      const css = await Bun.file(join(dir, 'dist', 'files', 'css', 'styles.css')).text();
      expect(css).toContain('.scroll-reveal');
      expect(css).toContain('@keyframes scroll-reveal');
      expect(css).toContain('animation-timeline:scroll()');
    });
  });

  it('el masonry sigue el orden de bloques por defecto (header, trayectura, formatos, indice, referencias, footer)', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(join(dir, 'iteraciones.config.yaml'), 'lang: es-MX\ntoc: true\nformat:\n  latex: true\n', 'utf8');
      await writeFile(join(dir, 'bibliography.bib'), '@book{key1, author = {García, Lucía}, title = {Libro}, year = {2024}}\n', 'utf8');
      await writeFile(join(dir, 'test.md'), '---\ntitle: Test Document\ndate: 2026-01-01\n---\n\n# Sección\n\nCita [@key1].\n', 'utf8');
      process.exitCode = 0;
      await runBuild(dir);
      expect(process.exitCode).toBe(0);
      const html = await Bun.file(join(dir, 'dist', 'files', 'test-document.html')).text();
      const pos = (s: string): number => html.indexOf(s);
      expect(pos('block:header')).toBeGreaterThanOrEqual(0);
      expect(pos('block:header')).toBeLessThan(pos('block:trayectura'));
      expect(pos('block:trayectura')).toBeLessThan(pos('block:formatos'));
      expect(pos('block:formatos')).toBeLessThan(pos('block:indice'));
      expect(pos('block:indice')).toBeLessThan(pos('block:referencias'));
      expect(pos('block:referencias')).toBeLessThan(pos('block:footer'));
    });
  });

  it('format.html.blocks: un override individual mueve la tarjeta (formatos después de índice)', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(
        join(dir, 'iteraciones.config.yaml'),
        'lang: es-MX\ntoc: true\nformat:\n  latex: true\n  html:\n    blocks:\n      formatos: 4\n',
        'utf8',
      );
      await writeFile(join(dir, 'test.md'), '---\ntitle: Test Document\ndate: 2026-01-01\n---\n\n# Sección\n\nContenido.\n', 'utf8');
      process.exitCode = 0;
      await runBuild(dir);
      expect(process.exitCode).toBe(0);
      const html = await Bun.file(join(dir, 'dist', 'files', 'test-document.html')).text();
      const pos = (s: string): number => html.indexOf(s);
      expect(pos('block:formatos')).toBeGreaterThan(pos('block:indice'));
      // Empate formatos 4 / referencias 4 → desempate canónico: formatos antes
      expect(pos('block:formatos')).toBeLessThan(pos('block:footer'));
      expect(pos('block:header')).toBeLessThan(pos('block:trayectura'));
    });
  });

  it('sin toc, sin citas y sin formatos activos, los bloques ausentes no aparecen', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir); // html-only, toc false, sin citas ni formatos
      process.exitCode = 0;
      await runBuild(dir);
      expect(process.exitCode).toBe(0);
      const html = await Bun.file(join(dir, 'dist', 'files', 'test-document.html')).text();
      expect(html).not.toContain('block:formatos');
      expect(html).not.toContain('block:indice');
      expect(html).not.toContain('block:referencias');
      const pos = (s: string): number => html.indexOf(s);
      expect(pos('block:header')).toBeLessThan(pos('block:trayectura'));
      expect(pos('block:trayectura')).toBeLessThan(pos('block:footer'));
    });
  });

  it('el chip del contenido dice Trayectura (neologismo)', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      process.exitCode = 0;
      await runBuild(dir);
      expect(process.exitCode).toBe(0);
      const html = await Bun.file(join(dir, 'dist', 'files', 'test-document.html')).text();
      expect(html).toContain('>Trayectura</h2>');
      expect(html).not.toContain('>Trayectoria</h2>');
    });
  });

  it('--no-export no modifica dist/, reporta salidas no modificadas y el siguiente build las regenera', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      process.exitCode = 0;
      await runBuild(dir);
      expect(process.exitCode).toBe(0);

      const htmlPath = join(dir, 'dist', 'files', 'test-document.html');
      const before = await Bun.file(htmlPath).text();

      // Modificar el documento y ejecutar --no-export
      await writeFile(join(dir, 'test.md'), '---\ntitle: Test Document\ndate: 2026-01-01\n---\n\nContenido modificado.\n', 'utf8');
      const stdoutSpy = spyOn(process.stdout, 'write');
      try {
        process.exitCode = 0;
        await runBuild(dir, { noExport: true });
        expect(process.exitCode).toBe(0);
        const output = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
        expect(output).toContain('Salidas no modificadas');
        expect(output).not.toContain('Formatos generados');
      } finally {
        stdoutSpy.mockRestore();
      }

      // dist/ no se tocó
      const after = await Bun.file(htmlPath).text();
      expect(after).toBe(before);

      // El siguiente build normal regenera las salidas con el contenido nuevo
      process.exitCode = 0;
      await runBuild(dir);
      expect(process.exitCode).toBe(0);
      const regenerated = await Bun.file(htmlPath).text();
      expect(regenerated).not.toBe(before);
      expect(regenerated).toContain('Contenido modificado');
    });
  });
});

describe('runInfo', () => {
  afterEach(resetExitCode);

  /** Ejecuta info y captura stdout. */
  async function infoOutput(dir: string): Promise<string> {
    const stdoutSpy = spyOn(process.stdout, 'write');
    let output = '';
    try {
      process.exitCode = 0;
      await runInfo(dir);
    } finally {
      output = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
      stdoutSpy.mockRestore();
    }
    return output;
  }

  it('refleja el directorio de salida real del último build', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      process.exitCode = 0;
      await runBuild(dir, { outputDir: 'salida' });
      const output = await infoOutput(dir);
      expect(process.exitCode).toBe(0);
      expect(output).toContain(join(dir, 'salida'));
      expect(output).toContain('(generado)');
    });
  });

  it('distingue preamble desactivados por defecto de los del usuario', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(
        join(dir, 'iteraciones.config.yaml'),
        'lang: es-MX\nformat:\n  pdf:\n    disabled-preamble-filters:\n      - 19-maketitle\n',
        'utf8',
      );
      const output = await infoOutput(dir);
      expect(output).toContain('preamble desactivados:');
      expect(output).toContain('19-maketitle');
      expect(output).toContain('preamble adicionales:');
    });
  });

  it('sin desactivaciones de usuario, preamble adicionales es (ninguno)', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      const output = await infoOutput(dir);
      expect(output).toContain('preamble adicionales:');
      expect(output).toContain('(ninguno)');
    });
  });
});

describe('runFilters', () => {
  afterEach(resetExitCode);

  it('muestra descripciones completas (líneas de comentario unidas) y columnas alineadas', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      const stdoutSpy = spyOn(process.stdout, 'write');
      let output = '';
      try {
        process.exitCode = 0;
        await runFilters(dir);
      } finally {
        output = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
        stdoutSpy.mockRestore();
      }
      // La descripción de latex/02-dictum tiene 3 líneas de comentario: la
      // frase completa termina en "si es Para." (antes se truncaba a mitad).
      expect(output).toContain('si es Para.');
      expect(output).not.toContain('(formato LaTeX), con  [');
      // Columnas alineadas: el nombre padded seguido de la columna lua
      expect(output).toMatch(/latex\/02-dictum {2,}lua {2}Convierte/);
      expect(process.exitCode).toBe(0);
    });
  });
});

describe('runValidate', () => {
  afterEach(resetExitCode);

  it('termina con exit 0 con config válida y documentos con frontmatter', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      process.exitCode = 0;
      await runValidate(dir);
      expect(process.exitCode).toBe(0);
    });
  });

  it('termina con exit 1 con YAML de config inválido', async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, 'iteraciones.config.yaml'), 'lang: [inválido\n', 'utf8');
      process.exitCode = 0;
      await runValidate(dir);
      expect(process.exitCode).toBe(1);
    });
  });

  it('reporta una sola línea de resumen con plural correcto (1 error)', async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, 'iteraciones.config.yaml'), 'lang: [inválido\n', 'utf8');
      const stderrSpy = spyStderr();
      let output = '';
      try {
        process.exitCode = 0;
        await runValidate(dir);
      } finally {
        output = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
        stderrSpy.mockRestore();
      }
      expect(output).toContain('✖ [validate] 1 error:');
      expect(output).not.toContain('error(es)');
      expect(output).not.toContain('se encontraron');
      expect(output).not.toContain('errors:');
    });
  });

  it('reporta 2 errores con plural correcto', async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, 'iteraciones.config.yaml'), 'lang: [inválido\n', 'utf8');
      await writeFile(join(dir, 'roto.md'), '---\ntitle: "Roto"\ninvalid: [unclosed\n---\n\nContenido.\n', 'utf8');
      const stderrSpy = spyStderr();
      let output = '';
      try {
        process.exitCode = 0;
        await runValidate(dir);
      } finally {
        output = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
        stderrSpy.mockRestore();
      }
      expect(output).toContain('✖ [validate] 2 errores:');
      expect(output).not.toContain('error(es)');
      expect(output).not.toContain('se encontraron');
    });
  });

  it('advierte sobre campos de frontmatter ignorados sin romper el exit code', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(join(dir, 'extra.md'), '---\ntitle: Extra\nabstract: Resumen del trabajo\nkeywords: [uno, dos]\n---\n\nContenido.\n', 'utf8');
      const stderrSpy = spyStderr();
      let output = '';
      try {
        process.exitCode = 0;
        await runValidate(dir);
      } finally {
        output = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
        stderrSpy.mockRestore();
      }
      expect(output).toContain('campos de frontmatter ignorados por el pipeline: abstract, keywords');
      expect(output).toContain('extra.md');
      expect(process.exitCode).toBe(0);
    });
  });

  it('no advierte con solo campos conocidos', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      const stderrSpy = spyStderr();
      let output = '';
      try {
        process.exitCode = 0;
        await runValidate(dir);
      } finally {
        output = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
        stderrSpy.mockRestore();
      }
      expect(output).not.toContain('ignorados');
      expect(process.exitCode).toBe(0);
    });
  });

  it('reporta error con rutas de bibliografía o CSL inexistentes', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(join(dir, 'iteraciones.config.yaml'), 'lang: es-MX\nbibliography: refs/no-existe.bib\n', 'utf8');
      const stderrSpy = spyStderr();
      let output = '';
      try {
        process.exitCode = 0;
        await runValidate(dir);
      } finally {
        output = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
        stderrSpy.mockRestore();
      }
      expect(output).toContain('bibliography: "refs/no-existe.bib" no encontrado en el proyecto');
      expect(process.exitCode).toBe(1);
    });
  });
});

describe('runDoctor', () => {
  afterEach(resetExitCode);

  /** Ejecuta doctor y captura la salida de stdout. */
  async function doctorOutput(dir: string): Promise<string> {
    const stdoutSpy = spyOn(process.stdout, 'write');
    let output = '';
    try {
      process.exitCode = 0;
      await runDoctor(dir);
    } finally {
      output = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
      stdoutSpy.mockRestore();
    }
    return output;
  }

  it('no verifica el motor LaTeX cuando el proyecto no usa PDF ni LaTeX', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir); // config html-only
      const output = await doctorOutput(dir);
      expect(process.exitCode).toBe(0);
      expect(output).not.toContain('pdflatex');
    });
  });

  it('verifica el motor LaTeX cuando format.pdf está activo', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(join(dir, 'iteraciones.config.yaml'), 'lang: es-MX\nformat:\n  pdf:\n    generate: true\n', 'utf8');
      const output = await doctorOutput(dir);
      expect(output).toContain('pdflatex disponible');
    });
  });

  it('renderiza cada check con ✔/✖ y sin códigos de escape', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir); // config html-only válida
      const output = await doctorOutput(dir);
      expect(output).toContain('✔ iteraciones.config.yaml');
      expect(output).toContain('✔ permisos de lectura en cwd');
      expect(output).not.toContain('\x1b');
    });
  });

  it('muestra ✖ con el detalle cuando la config es inválida y sale con código 1', async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, 'iteraciones.config.yaml'), ':: yaml inválido ::', 'utf8');
      const output = await doctorOutput(dir);
      expect(output).toContain('✖ iteraciones.config.yaml');
      expect(output).toContain('Error de sintaxis');
      expect(process.exitCode).toBe(1);
    });
  });
});

describe('runInit', () => {
  afterEach(resetExitCode);

  it('crea los tres archivos en un directorio vacío', async () => {
    await withTempDir(async (dir) => {
      process.exitCode = 0;
      await runInit(dir);
      expect(process.exitCode).toBe(0);
      expect(await Bun.file(join(dir, 'iteraciones.config.yaml')).exists()).toBe(true);
      expect(await Bun.file(join(dir, 'README.md')).exists()).toBe(true);
      expect(await Bun.file(join(dir, 'bibliography.bib')).exists()).toBe(true);
    });
  });

  it('no sobreescribe archivos existentes y no falla', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      process.exitCode = 0;
      // Llamar init de nuevo: los archivos ya existen
      await runInit(dir);
      expect(process.exitCode).toBe(0);
    });
  });

  it('el config generado incluye los defaults de format.html.blocks', async () => {
    await withTempDir(async (dir) => {
      process.exitCode = 0;
      await runInit(dir);
      expect(process.exitCode).toBe(0);
      const yaml = await Bun.file(join(dir, 'iteraciones.config.yaml')).text();
      const parsed = Bun.YAML.parse(yaml) as { format?: { html?: { blocks?: Record<string, number> } } };
      expect(parsed.format?.html?.blocks).toEqual(DEFAULT_HTML_BLOCKS);
    });
  });
});

describe('runNew', () => {
  afterEach(resetExitCode);

  it('crea un archivo .md con frontmatter mínimo', async () => {
    await withTempDir(async (dir) => {
      process.exitCode = 0;
      await runNew(dir, 'posts/mi-articulo');
      expect(process.exitCode).toBe(0);
      const file = Bun.file(join(dir, 'posts/mi-articulo.md'));
      expect(await file.exists()).toBe(true);
      const content = await file.text();
      expect(content).toContain('title:');
      expect(content).toContain('date:');
    });
  });

  it('añade extensión .md si no se especifica', async () => {
    await withTempDir(async (dir) => {
      await runNew(dir, 'ensayo');
      expect(await Bun.file(join(dir, 'ensayo.md')).exists()).toBe(true);
    });
  });

  it('normaliza espacios del nombre a guiones', async () => {
    await withTempDir(async (dir) => {
      process.exitCode = 0;
      await runNew(dir, 'mi articulo nuevo');
      expect(process.exitCode).toBe(0);
      expect(await Bun.file(join(dir, 'mi-articulo-nuevo.md')).exists()).toBe(true);
      const content = await Bun.file(join(dir, 'mi-articulo-nuevo.md')).text();
      expect(content).toContain('title: "Mi articulo nuevo"');
    });
  });

  it('genera frontmatter YAML válido con apóstrofos y comillas en el título', async () => {
    await withTempDir(async (dir) => {
      process.exitCode = 0;
      await runNew(dir, "d'artagnan");
      await runNew(dir, 'comillas', { title: 'El "jardín" de las delicias' });
      expect(process.exitCode).toBe(0);
      const content = await Bun.file(join(dir, "d'artagnan.md")).text();
      expect(content).toContain('title: "D\'artagnan"');
      const quoted = await Bun.file(join(dir, 'comillas.md')).text();
      expect(quoted).toContain('title: "El \\"jardín\\" de las delicias"');
    });
  });

  it('el round-trip new → validate → build funciona con títulos difíciles', async () => {
    await withTempDir(async (dir) => {
      process.exitCode = 0;
      await runNew(dir, 'articulo', { title: "Los tres mosqueteros: d'Artagnan" });
      await runValidate(dir);
      expect(process.exitCode).toBe(0);
      await runBuild(dir);
      expect(process.exitCode).toBe(0);
    });
  });

  it('--title tiene prioridad sobre la inferencia del nombre', async () => {
    await withTempDir(async (dir) => {
      process.exitCode = 0;
      await runNew(dir, 'mi-articulo', { title: 'Título explícito' });
      expect(process.exitCode).toBe(0);
      const content = await Bun.file(join(dir, 'mi-articulo.md')).text();
      expect(content).toContain('title: "Título explícito"');
    });
  });

  it('rechaza rutas absolutas', async () => {
    await withTempDir(async (dir) => {
      process.exitCode = 0;
      await runNew(dir, '/etc/passwd');
      expect(process.exitCode).toBe(1);
    });
  });

  it('no falla si el archivo ya existe', async () => {
    await withTempDir(async (dir) => {
      await runNew(dir, 'doc');
      process.exitCode = 0;
      await runNew(dir, 'doc');
      expect(process.exitCode).toBe(0);
    });
  });
});

describe('runBuild (copyToDist)', () => {
  afterEach(resetExitCode);

  it('avisa si un archivo generado falta en la caché (dist no queda incompleto en silencio)', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(join(dir, 'otro.md'), '---\ntitle: Otro\n---\n\nContenido.\n', 'utf8');
      process.exitCode = 0;
      await runBuild(dir);
      expect(process.exitCode).toBe(0);

      // Eliminar el HTML generado de la caché para el documento NO modificado:
      // el build siguiente (con trabajo en test.md) intenta copiarlo y falta.
      await rm(join(dir, '.iteraciones', 'formats', 'html', 'otro.html'), { force: true });
      await writeFile(join(dir, 'test.md'), '---\ntitle: Test Document\ndate: 2026-01-01\n---\n\nContenido modificado.\n', 'utf8');
      const stdoutSpy = spyOn(process.stdout, 'write');
      let output = '';
      try {
        process.exitCode = 0;
        await runBuild(dir);
      } finally {
        output = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
        stdoutSpy.mockRestore();
      }
      // Los warnings se difieren al resumen final (bloque Advertencias en stdout)
      expect(output).toContain('no se encontró el archivo generado');
      expect(output).toContain('otro.html');
      expect(process.exitCode).toBe(0);
    });
  });
});

describe('runClean', () => {
  afterEach(resetExitCode);

  it('elimina dist/ y .iteraciones/', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      // Crear directorios simulando un build previo
      const { mkdir } = await import('node:fs/promises');
      await mkdir(join(dir, 'dist', 'files'), { recursive: true });
      await mkdir(join(dir, '.iteraciones', 'ast'), { recursive: true });
      process.exitCode = 0;
      await runClean(dir);
      expect(process.exitCode).toBe(0);
      expect(await Bun.file(join(dir, 'dist')).exists()).toBe(false);
      expect(await Bun.file(join(dir, '.iteraciones')).exists()).toBe(false);
    });
  });
});
