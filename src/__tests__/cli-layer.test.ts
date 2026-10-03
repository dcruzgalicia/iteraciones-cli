import { afterEach, beforeAll, describe, expect, it, spyOn } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runBuild, runValidate } from '../cli/dispatcher.js';
import { checkLatexEngine } from '../cli/doctor/system-checks.js';
import { getPandocVersion } from '../lib/pandoc-runner.js';
import { initTestProject, registerSkip, SKIP_REASONS, withTempDir } from './helpers.js';

// Los tests que invocan pandoc real se marcan como skip si no está instalado
// (mismo patrón que integration.test.ts): sin pandoc la suite pasa con skips.
const pandocOk = await getPandocVersion().catch(() => null);
if (!pandocOk) registerSkip('cli-layer.test.ts', SKIP_REASONS.pandoc);
// unzip se usa para inspeccionar EPUBs generados: skip real si no está en PATH.
const unzipOk = (await Bun.which('unzip')) !== null;

// La suite aserta strings exactos de la salida: la colorización ANSI se fuerza
// off aunque el stream sea un TTY (los asserts no dependen del entorno).
// NO_COLOR es el mecanismo estándar; el logger lo lee directo.
beforeAll(() => {
  process.env.NO_COLOR = '1';
});

// El smoke de PDF real solo corre si el motor LaTeX está disponible.
const _latexOk = (await checkLatexEngine()).ok;

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

describe.skipIf(!pandocOk)('runBuild', () => {
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
      // Proyecto con config pero sin documentos (#2071: sin config el build falla antes)
      await writeFile(
        join(dir, 'iteraciones.config.yaml'),
        ['language: es-MX', 'format:', '  html:', '    site:', '      title: Test', '    generate: true'].join('\n'),
        'utf8',
      );
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
      expect(out).toMatch(/Formatos activos\s+0/);
      expect(out).not.toContain('reutilizado');
      // El aviso es un warning diferido al bloque Advertencias del resumen
      expect(out).toContain('⚠ [build] No se encontraron documentos Markdown en el proyecto.');
      // Con advertencias no hay "Todo listo.": el cierre es neutral
      expect(out).not.toContain('✔ Todo listo.');
      // El warning ya propone 'iteraciones init': la guía genérica de validate
      // no debe aparecer (validate respondería "sin errores — 0 documentos")
      expect(out).not.toContain("ejecuta 'iteraciones validate'");
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

  it('un cambio de bibliografía regenera las exportaciones', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(join(dir, 'iteraciones.config.yaml'), 'language: es-MX\nbibliography: refs/libro.bib\n', 'utf8');
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
      const htmlBefore = await Bun.file(join(dir, 'dist', 'files', 'test-document.html')).text();
      expect(htmlBefore).toContain('Título original');

      // Cambiar la bibliografía: las exportaciones se regeneran
      await writeFile(
        join(dir, 'refs', 'libro.bib'),
        '@book{ejemplo2024,\n  title = {Título nuevo},\n  author = {Autor},\n  year = {2024},\n}\n',
        'utf8',
      );
      process.exitCode = 0;
      await runBuild(dir);
      expect(process.exitCode).toBe(0);
      const htmlAfter = await Bun.file(join(dir, 'dist', 'files', 'test-document.html')).text();
      expect(htmlAfter).toContain('Título nuevo');
    });
  });

  it('titleImage: ruta absoluta en el tex con el guion bajo sin escapar', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(join(dir, 'iteraciones.config.yaml'), 'language: es-MX\nformat:\n  latex:\n    generate: true\n', 'utf8');
      // PNG 1x1 válido (base64)
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
      await writeFile(join(dir, 'mi_portada.png'), png);
      await writeFile(join(dir, 'test.md'), '---\ntitle: Test Document\ntitleImage: ./mi_portada.png\n---\n\nContenido.\n', 'utf8');
      process.exitCode = 0;
      await runBuild(dir);
      expect(process.exitCode).toBe(0);
      const tex = await Bun.file(join(dir, 'dist', 'files', 'test-document.tex')).text();
      // La imagen puede estar procesada (CMYK JPG) o sin procesar según ImageMagick
      const hasOriginal = tex.includes(`\\titleimage{${join(dir, 'mi_portada.png')}}`);
      const hasProcessed = tex.includes('\\titleimage{') && tex.includes('mi_portada');
      expect(hasOriginal || hasProcessed).toBe(true);
      expect(tex).not.toContain('\\_');
    });
  });

  it('titleImage: archivo inexistente falla con mensaje claro (no el de latexmk)', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(join(dir, 'iteraciones.config.yaml'), 'language: es-MX\nformat:\n  latex:\n    generate: true\n', 'utf8');
      await writeFile(join(dir, 'test.md'), '---\ntitle: Test Document\ntitleImage: ./no_existe.png\n---\n\nContenido.\n', 'utf8');
      const stderrSpy = spyStderr();
      let output = '';
      try {
        process.exitCode = 0;
        await runBuild(dir);
      } finally {
        output = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
        stderrSpy.mockRestore();
      }
      expect(process.exitCode).toBe(1);
      expect(output).toContain('titleImage no encontrado');
      expect(output).toContain(join(dir, 'no_existe.png'));
    });
  });

  it('titleImage desde la raíz de config se aplica a todos los documentos (3 niveles)', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
      await writeFile(join(dir, 'portada.png'), png);
      await writeFile(
        join(dir, 'iteraciones.config.yaml'),
        'language: es-MX\ntitleImage: ./portada.png\nformat:\n  latex:\n    generate: true\n',
        'utf8',
      );
      await writeFile(join(dir, 'test.md'), '---\ntitle: Test Document\n---\n\nContenido.\n', 'utf8');
      process.exitCode = 0;
      await runBuild(dir);
      expect(process.exitCode).toBe(0);
      const tex = await Bun.file(join(dir, 'dist', 'files', 'test-document.tex')).text();
      expect(tex).toContain('\\titleimage{');
    });
  });

  it('titleImage del frontmatter sobreescribe el de la config (3 niveles)', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
      await writeFile(join(dir, 'portada.png'), png);
      await writeFile(join(dir, 'portada-fm.png'), png);
      await writeFile(
        join(dir, 'iteraciones.config.yaml'),
        'language: es-MX\ntitleImage: ./portada.png\nformat:\n  latex:\n    generate: true\n',
        'utf8',
      );
      await writeFile(join(dir, 'test.md'), '---\ntitle: Test Document\ntitleImage: ./portada-fm.png\n---\n\nContenido.\n', 'utf8');
      process.exitCode = 0;
      await runBuild(dir);
      expect(process.exitCode).toBe(0);
      const tex = await Bun.file(join(dir, 'dist', 'files', 'test-document.tex')).text();
      expect(tex).toContain('\\titleimage{');
      expect(tex).toContain('portada-fm');
    });
  });

  it('un párrafo de 2-3 palabras al inicio no recibe \\mbox (umbral de palabras reales)', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(join(dir, 'iteraciones.config.yaml'), 'language: es-MX\nformat:\n  latex:\n    generate: true\n', 'utf8');
      await writeFile(join(dir, 'test.md'), '---\ntitle: Test Document\n---\n\nContenido corto.\n', 'utf8');
      process.exitCode = 0;
      await runBuild(dir);
      expect(process.exitCode).toBe(0);
      const tex = await Bun.file(join(dir, 'dist', 'files', 'test-document.tex')).text();
      expect(tex).toContain('\\noindent Contenido corto.');
      expect(tex).not.toContain('\\mbox{Contenido}');
    });
  });

  it('un slug manual inválido aborta el build con contexto', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(join(dir, 'test.md'), '---\ntitle: Test Document\nslug: Mi URL Inválida\n---\n\nContenido.\n', 'utf8');
      const stderrSpy = spyStderr();
      let output = '';
      try {
        process.exitCode = 0;
        await runBuild(dir);
      } finally {
        output = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
        stderrSpy.mockRestore();
      }
      expect(output).toContain('slug inválido');
      expect(process.exitCode).toBe(1);
    });
  });

  it('dos slugs manuales duplicados abortan el build (sobrescribirían las salidas)', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(join(dir, 'uno.md'), '---\ntitle: Uno\nslug: mismo\n---\n\nContenido.\n', 'utf8');
      await writeFile(join(dir, 'dos.md'), '---\ntitle: Dos\nslug: mismo\n---\n\nContenido.\n', 'utf8');
      const stderrSpy = spyStderr();
      let output = '';
      try {
        process.exitCode = 0;
        await runBuild(dir);
      } finally {
        output = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
        stderrSpy.mockRestore();
      }
      expect(output).toContain('slugs duplicados');
      expect(process.exitCode).toBe(1);
    });
  });

  it('validate reporta slugs manuales duplicados como error', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(join(dir, 'uno.md'), '---\ntitle: Uno\nslug: mismo\n---\n\nContenido.\n', 'utf8');
      await writeFile(join(dir, 'dos.md'), '---\ntitle: Dos\nslug: mismo\n---\n\nContenido.\n', 'utf8');
      const stderrSpy = spyStderr();
      let output = '';
      try {
        process.exitCode = 0;
        await runValidate(dir);
      } finally {
        output = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
        stderrSpy.mockRestore();
      }
      expect(output).toContain('slug duplicado');
      expect(process.exitCode).toBe(1);
    });
  });

  it.skipIf(!pandocOk)(
    'index.md genera index.* en todos los formatos (naming coherente)',
    async () => {
      await withTempDir(async (dir) => {
        await initTestProject(dir);
        await writeFile(
          join(dir, 'iteraciones.config.yaml'),
          'language: es-MX\nformat:\n  latex:\n    generate: true\n  pdf:\n    generate: true\n  html:\n    generate: true\n  epub:\n    generate: true\n  markdown:\n    generate: true\n',
          'utf8',
        );
        await writeFile(join(dir, 'index.md'), '---\ntitle: Inicio\ndate: 2026-01-01\n---\n\nInicio.\n', 'utf8');
        process.exitCode = 0;
        await runBuild(dir);
        expect(process.exitCode).toBe(0);
        for (const ext of ['html', 'pdf', 'tex', 'epub', 'md']) {
          expect(await Bun.file(join(dir, 'dist', 'files', `index.${ext}`)).exists()).toBe(true);
        }
        // Ninguna salida con el slug por título (antes: inicio.pdf, inicio.tex...)
        for (const ext of ['pdf', 'tex', 'epub', 'md']) {
          expect(await Bun.file(join(dir, 'dist', 'files', `inicio.${ext}`)).exists()).toBe(false);
        }
      });
    },
    { timeout: 300_000 },
  );

  it.skipIf(!pandocOk)('el lang de la configuración configura babel en el PDF (contrato lang → babel)', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(join(dir, 'iteraciones.config.yaml'), 'language: en\nformat:\n  latex:\n    generate: true\n', 'utf8');
      process.exitCode = 0;
      await runBuild(dir);
      expect(process.exitCode).toBe(0);
      const tex = await Bun.file(join(dir, 'dist', 'files', 'test-document.tex')).text();
      expect(tex).toContain('\\usepackage[english]{babel}');
    });
  });

  it.skipIf(!pandocOk)('el lang por defecto es-MX mantiene las opciones históricas de babel', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(join(dir, 'iteraciones.config.yaml'), 'language: es-MX\nformat:\n  latex:\n    generate: true\n', 'utf8');
      process.exitCode = 0;
      await runBuild(dir);
      expect(process.exitCode).toBe(0);
      const tex = await Bun.file(join(dir, 'dist', 'files', 'test-document.tex')).text();
      expect(tex).toContain('\\usepackage[spanish,mexico,es-noshorthands,es-noindentfirst]{babel}');
    });
  });

  it.skipIf(!pandocOk || !unzipOk)('el EPUB generado incluye título, autor e idioma en sus metadatos', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(join(dir, 'iteraciones.config.yaml'), ['language: es-MX', 'format:', '  epub:', '    generate: true'].join('\n'), 'utf8');
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

  it('un documento sin cuerpo es error de build: no se omite en silencio (#2463)', async () => {
    // Frontmatter cerrado sin cuerpo. Corridas separadas: la emisión es
    // concurrente y solo llega un error por build.
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
      expect(process.exitCode).toBe(1);
      expect(output).toContain('vacio.md');
      expect(output).toContain('no tiene contenido después del frontmatter; agrega un body para proceder con el build');
    });

    // Archivo enteramente vacío, sin frontmatter.
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(join(dir, 'hueco.md'), '', 'utf8');
      const stderrSpy = spyStderr();
      let output = '';
      try {
        process.exitCode = 0;
        await runBuild(dir);
      } finally {
        output = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
        stderrSpy.mockRestore();
      }
      expect(process.exitCode).toBe(1);
      expect(output).toContain('hueco.md');
      expect(output).toContain('está vacío; agrega un body para proceder con el build');
    });
  });

  it('collection e intervention sin body propio siguen siendo válidas en build y validate (#2463)', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(
        join(dir, 'coleccion.md'),
        ['---', 'title: Antología', 'type: collection', 'files:', '  - test.md', '---', ''].join('\n'),
        'utf8',
      );
      await writeFile(join(dir, 'intervencion.md'), ['---', 'title: Intervención', 'type: intervention', '---', ''].join('\n'), 'utf8');

      process.exitCode = 0;
      await runBuild(dir);
      expect(process.exitCode).toBe(0);

      const stdoutSpy = spyOn(process.stdout, 'write');
      let raw = '';
      try {
        process.exitCode = 0;
        await runValidate(dir, { json: true });
      } finally {
        raw = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
        stdoutSpy.mockRestore();
      }
      expect(process.exitCode).toBe(0);
      const resumen = JSON.parse(raw.trim()) as { ok: boolean; errors: unknown[]; warnings: { file: string }[] };
      expect(resumen.ok).toBe(true);
      expect(resumen.errors).toEqual([]);
      expect(resumen.warnings.filter((w) => w.file === 'coleccion.md' || w.file === 'intervencion.md')).toEqual([]);
    });
  });

  it('un miembro vacío de una collection rompe build y validate (no deja files[] colgando) (#2463)', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(
        join(dir, 'index.md'),
        ['---', 'title: Antología', 'type: collection', 'files:', '  - test.md', '  - vacio.md', '---', ''].join('\n'),
        'utf8',
      );
      await writeFile(join(dir, 'vacio.md'), '---\ntitle: Vacío\n---\n', 'utf8');

      const buildSpy = spyStderr();
      let output = '';
      try {
        process.exitCode = 0;
        await runBuild(dir);
      } finally {
        output = buildSpy.mock.calls.map((c) => String(c[0])).join('');
        buildSpy.mockRestore();
      }
      expect(process.exitCode).toBe(1);
      expect(output).toContain('vacio.md');
      expect(output).toContain('agrega un body para proceder con el build');

      // validate dice exactamente lo mismo del mismo proyecto (#2463).
      const validateSpy = spyStderr();
      let validateOutput = '';
      try {
        process.exitCode = 0;
        await runValidate(dir);
      } finally {
        validateOutput = validateSpy.mock.calls.map((c) => String(c[0])).join('');
        validateSpy.mockRestore();
      }
      expect(process.exitCode).toBe(1);
      expect(validateOutput).toContain('vacio.md');
      expect(validateOutput).toContain('agrega un body para proceder con el build');
    });
  });

  it('el siguiente build reintenta el documento que falló (no envenena la caché)', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      // Frontmatter YAML inválido: el build falla en discovery
      await writeFile(join(dir, 'vacio.md'), '---\ntitle: [roto\n---\n\nContenido.\n', 'utf8');
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
      expect(output).toContain('Documentos');
      expect(output).not.toContain('Sin cambios (reutilizado)');
    });
  });

  it('un estado sin completed se ignora y el siguiente build reprocesa (interrupción simulada)', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      process.exitCode = 0;
      await runBuild(dir);
      expect(process.exitCode).toBe(0);

      // Simular un build interrumpido a mitad de render: el estado persistido
      // por discover no tiene completed (el marcado final nunca ocurrió) y el
      // documento cambió después de discovery.
      await writeFile(join(dir, 'test.md'), '---\ntitle: Contenido nuevo\ndate: 2026-01-02\n---\n\nContenido nuevo.\n', 'utf8');
      const statePath = join(dir, '.iteraciones', 'state.json');
      const raw = JSON.parse(await Bun.file(statePath).text()) as Record<string, unknown>;
      delete raw.completed;
      await Bun.write(statePath, JSON.stringify(raw));

      // El build debe reprocesar todo (el estado no es caché válida) y dejar
      // el estado marcado como completo para el siguiente build.
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
      expect(output).toContain('Documentos');
      expect(output).not.toContain('Sin cambios (reutilizado)');
      const finalState = JSON.parse(await Bun.file(statePath).text()) as { completed?: boolean };
      expect(finalState.completed).toBe(true);

      // Un build posterior sin cambios reutiliza la caché (camino normal).
      const cachedSpy = spyOn(process.stdout, 'write');
      let cachedOutput = '';
      try {
        process.exitCode = 0;
        await runBuild(dir);
      } finally {
        cachedOutput = cachedSpy.mock.calls.map((c) => String(c[0])).join('');
        cachedSpy.mockRestore();
      }
      expect(process.exitCode).toBe(0);
      expect(cachedOutput).toContain('(reutilizado)');
    });
  });

  it('un error de pandoc reporta la ruta del documento una sola vez', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(join(dir, 'iteraciones.config.yaml'), 'language: es-MX\nluaFilters: [filters/roto.lua]\n', 'utf8');
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

  it('el CSS se compila sobre los HTML finales: template, HTML de markdown y acento', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      process.exitCode = 0;
      await runBuild(dir);
      const cssPath = join(dir, 'dist', 'files', 'assets', 'css', 'styles.css');
      const css = await Bun.file(cssPath).text();
      // Clases del template presentes y acento por defecto (lime) compilado directo
      expect(css).toContain('prose-xl');
      expect(css).toContain('oklch(76.8% .233 130.85)'); // lime-500

      // Archivos .md dentro de dist/ y .iteraciones/ no afectan el CSS (el
      // scan solo lee los HTML finales de dist/files)
      const { mkdir } = await import('node:fs/promises');
      await mkdir(join(dir, 'dist', 'files'), { recursive: true });
      await mkdir(join(dir, '.iteraciones', 'changes'), { recursive: true });
      await writeFile(join(dir, 'dist', 'files', 'basura.md'), 'bg-fuchsia-700\n', 'utf8');
      await writeFile(join(dir, '.iteraciones', 'changes', 'basura.md'), 'bg-indigo-700\n', 'utf8');

      // HTML personalizado en markdown: queda estilizado por el CSS final
      await writeFile(
        join(dir, 'test.md'),
        '---\ntitle: Test Document\ndate: 2026-01-01\n---\n\n<div class="bg-teal-300">x</div>\n\nNuevo contenido.\n',
        'utf8',
      );
      process.exitCode = 0;
      await runBuild(dir);
      const css2 = await Bun.file(cssPath).text();
      expect(css2).toContain('bg-teal-300'); // HTML del markdown compilado
      expect(css2).not.toContain('bg-fuchsia-700');
      expect(css2).not.toContain('bg-indigo-700');
    });
  });

  it('un heading Referencias propio del documento se conserva (sin citas)', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(
        join(dir, 'test.md'),
        '---\ntitle: Test Document\ndate: 2026-01-01\n---\n\nTexto.\n\n# Referencias {#referencias}\n\nManual.\n',
        'utf8',
      );
      process.exitCode = 0;
      await runBuild(dir);
      expect(process.exitCode).toBe(0);
      const html = await Bun.file(join(dir, 'dist', 'files', 'test-document.html')).text();
      // El heading del usuario se conserva (antes el post-procesamiento lo eliminaba)
      expect(html).toContain('<h5 id="referencias">Referencias</h5>');
      expect(html).toContain('Manual.');
      // Sin citas no hay heading sintético ni tarjeta
      expect(html).not.toContain('refs-heading');
    });
  });

  it('un heading Referencias propio se conserva aunque haya citas (sin ids duplicados)', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(join(dir, 'bibliography.bib'), '@book{key1, author = {García, Lucía}, title = {Libro}, year = {2024}}\n', 'utf8');
      await writeFile(
        join(dir, 'test.md'),
        '---\ntitle: Test Document\ndate: 2026-01-01\n---\n\nCita [@key1].\n\n# Referencias {#referencias}\n\nManual.\n',
        'utf8',
      );
      process.exitCode = 0;
      await runBuild(dir);
      expect(process.exitCode).toBe(0);
      const html = await Bun.file(join(dir, 'dist', 'files', 'test-document.html')).text();
      // El heading del usuario se conserva en el body y el sintético usa su id
      expect(html).toContain('<h5 id="referencias">Referencias</h5>');
      expect(html).toContain('id="refs-heading"');
      // Un solo id referencias (el del usuario): sin duplicados
      expect((html.match(/id="referencias"/g) ?? []).length).toBe(1);
      expect(html).toContain('csl-entry');
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

  it('el bloque de referencias conserva el orden heading antes de div#refs (orden de argv de citeproc)', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(join(dir, 'bibliography.bib'), '@book{key1, author = {García, Lucía}, title = {Libro}, year = {2024}}\n', 'utf8');
      await writeFile(join(dir, 'test.md'), '---\ntitle: Test Document\ndate: 2026-01-01\n---\n\nCita [@key1].\n', 'utf8');
      process.exitCode = 0;
      await runBuild(dir);
      expect(process.exitCode).toBe(0);
      const html = await Bun.file(join(dir, 'dist', 'files', 'test-document.html')).text();
      // Si --citeproc se moviera antes de los --lua-filter, citeproc insertaría
      // div#refs DESPUÉS del heading sintético y la extracción fallaría: este
      // orden (heading antes de refs) es parte del contrato de argv.
      expect(html.indexOf('id="refs-heading"')).toBeLessThan(html.indexOf('<div id="refs"'));
    });
  });

  it('citas sin entrada en la bibliografía no dejan la sección de referencias huérfana', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(join(dir, 'bibliography.bib'), '@book{key1, author = {García, Lucía}, title = {Libro}, year = {2024}}\n', 'utf8');
      // El citekey no existe en el .bib: citeproc no genera div#refs y el heading
      // sintético quedaría huérfano dentro del contenido.
      await writeFile(
        join(dir, 'test.md'),
        '---\ntitle: Test Document\ndate: 2026-01-01\n---\n\n# Sección\n\nCita rota [@key-inexistente].\n',
        'utf8',
      );
      process.exitCode = 0;
      await runBuild(dir);
      expect(process.exitCode).toBe(0);
      const html = await Bun.file(join(dir, 'dist', 'files', 'test-document.html')).text();
      // Ni el heading sintético ni el marcador quedan en el output final
      expect(html).not.toContain('<h1 id="refs-heading">');
      expect(html).not.toContain('block:referencias');
      // El contenido normal sí está
      expect(html).toContain('<h5 id="sección">Sección</h5>');
    });
  });

  it('el índice no enlaza a referencias y la tarjeta conserva su chip', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(join(dir, 'iteraciones.config.yaml'), 'language: es-MX\ntoc: true\nformat:\n  latex:\n    generate: true\n', 'utf8');
      await writeFile(join(dir, 'bibliography.bib'), '@book{key1, author = {García, Lucía}, title = {Libro}, year = {2024}}\n', 'utf8');
      await writeFile(join(dir, 'test.md'), '---\ntitle: Test Document\ndate: 2026-01-01\n---\n\n# Sección\n\nCita [@key1].\n', 'utf8');
      process.exitCode = 0;
      await runBuild(dir);
      expect(process.exitCode).toBe(0);
      const html = await Bun.file(join(dir, 'dist', 'files', 'test-document.html')).text();
      // El bloque del índice no contiene el enlace a referencias
      const indiceStart = html.indexOf('<nav id="TOC"');
      const indiceEnd = html.indexOf('</nav>', indiceStart);
      const indiceBlock = html.slice(indiceStart, indiceEnd);
      expect(indiceBlock).not.toContain('href="#refs-heading"');
      // La tarjeta de referencias conserva su chip y sus entradas
      expect(html).toContain('id="refs-heading"');
      expect(html).toContain('>Referencias</h2>');
      expect(html).toContain('csl-entry');
      // Las citas del texto siguen enlazando a sus entradas (link-citations)
      expect(html).toContain('href="#ref-key1"');
    });
  });

  it('las tarjetas de formatos y referencias se insertan fuera de la tarjeta de contenido (regresión #1445)', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(join(dir, 'iteraciones.config.yaml'), 'language: es-MX\nformat:\n  latex:\n    generate: true\n', 'utf8');
      await writeFile(join(dir, 'bibliography.bib'), '@book{key1, author = {García, Lucía}, title = {Libro}, year = {2024}}\n', 'utf8');
      await writeFile(join(dir, 'test.md'), '---\ntitle: Test Document\ndate: 2026-01-01\n---\n\n# Sección\n\nCita [@key1].\n', 'utf8');
      process.exitCode = 0;
      await runBuild(dir);
      expect(process.exitCode).toBe(0);
      const html = await Bun.file(join(dir, 'dist', 'files', 'test-document.html')).text();
      // #2487: la tarjeta Formatos va antes de la de contenido (orden por
      // defecto), pero siempre fuera de su article
      expect(html.indexOf('>Descarga</h2>')).toBeLessThan(html.indexOf('<article'));
      // Las referencias viven en su propia tarjeta, fuera del article
      expect(html.indexOf('id="refs-heading"')).toBeGreaterThan(html.indexOf('</article>'));
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
      // #2487: un solo main —container + mx-auto para el ancho máximo y el
      // centrado, una columna por defecto, dos desde lg, tres desde 2xl— con su
      // aire de arriba (8) y el de abajo (24) que deja libre el botón flotante
      expect(html).toContain('<main class="container mx-auto columns-1 lg:columns-2 2xl:columns-3 gap-6 px-4 sm:px-6 lg:px-8 pt-8 pb-24">');
      // El botón no es un bloque del masonry (fuera del sistema de bloques)
      expect(html).not.toContain('block:volver');
      // El CSS precompilado incluye la animación scroll-driven
      const css = await Bun.file(join(dir, 'dist', 'files', 'assets', 'css', 'styles.css')).text();
      expect(css).toContain('.scroll-reveal');
      expect(css).toContain('@keyframes scroll-reveal');
      expect(css).toContain('animation-timeline:scroll()');
    });
  });

  it('el masonry sigue el orden de bloques por defecto (header, título, indice, formatos, contenido, referencias, footer)', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(join(dir, 'iteraciones.config.yaml'), 'language: es-MX\ntoc: true\nformat:\n  latex:\n    generate: true\n', 'utf8');
      await writeFile(join(dir, 'bibliography.bib'), '@book{key1, author = {García, Lucía}, title = {Libro}, year = {2024}}\n', 'utf8');
      await writeFile(join(dir, 'test.md'), '---\ntitle: Test Document\ndate: 2026-01-01\n---\n\n# Sección\n\nCita [@key1].\n', 'utf8');
      process.exitCode = 0;
      await runBuild(dir);
      expect(process.exitCode).toBe(0);
      const html = await Bun.file(join(dir, 'dist', 'files', 'test-document.html')).text();
      const pos = (s: string): number => html.indexOf(s);
      // Contenido distintivo de cada tarjeta (sin marcadores internos)
      expect(pos('Tarjeta identidad')).toBeGreaterThanOrEqual(0); // header
      expect(pos('Tarjeta identidad'), 'el título va tras el header').toBeLessThan(pos('>Descarga</h2>'));
      expect(pos('id="TOC"')).toBeLessThan(pos('>Descarga</h2>'));
      expect(pos('>Descarga</h2>')).toBeLessThan(pos('<article')); // contenido
      expect(pos('<article')).toBeLessThan(pos('id="refs-heading"'));
      expect(pos('id="refs-heading"')).toBeLessThan(html.lastIndexOf('Tarjeta identidad final')); // footer
    });
  });

  it('format.html.blocks: una lista explícita ES el orden (formato después de índice)', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(
        join(dir, 'iteraciones.config.yaml'),
        'language: es-MX\ntoc: true\nformat:\n  latex:\n    generate: true\n  html:\n    blocks:\n      - header\n      - contenido\n      - indice\n      - formatos\n      - referencias\n      - footer\n',
        'utf8',
      );
      await writeFile(join(dir, 'test.md'), '---\ntitle: Test Document\ndate: 2026-01-01\n---\n\n# Sección\n\nContenido.\n', 'utf8');
      process.exitCode = 0;
      await runBuild(dir);
      expect(process.exitCode).toBe(0);
      const html = await Bun.file(join(dir, 'dist', 'files', 'test-document.html')).text();
      const pos = (s: string): number => html.indexOf(s);
      expect(pos('>Descarga</h2>')).toBeGreaterThan(pos('id="TOC"'));
      expect(pos('Tarjeta identidad')).toBeLessThan(pos('<article'));
    });
  });

  it('sin toc, sin citas y sin formatos activos, los bloques ausentes no aparecen', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir); // html-only, toc false, sin citas ni formatos
      process.exitCode = 0;
      await runBuild(dir);
      expect(process.exitCode).toBe(0);
      const html = await Bun.file(join(dir, 'dist', 'files', 'test-document.html')).text();
      expect(html).not.toContain('>Descarga</h2>');
      expect(html).not.toContain('id="TOC"');
      expect(html).not.toContain('refs-heading');
      const pos = (s: string): number => html.indexOf(s);
      expect(pos('Tarjeta identidad')).toBeLessThan(pos('<article'));
      expect(pos('<article')).toBeLessThan(html.lastIndexOf('Tarjeta identidad final'));
    });
  });

  it('sin HTML activo, el build no copia fuentes ni sus licencias a la salida', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(
        join(dir, 'iteraciones.config.yaml'),
        'language: es-MX\nformat:\n  html:\n    generate: false\n  latex:\n    generate: true\n',
        'utf8',
      );
      process.exitCode = 0;
      await runBuild(dir);
      expect(process.exitCode).toBe(0);
      // Las fuentes (y sus licencias) son assets de HTML: sin HTML no se copian
      expect(await Bun.file(join(dir, 'dist', 'files', 'fonts')).exists()).toBe(false);
    });
  });

  it('el chip de la tarjeta de título dice el type: Texto, Colección o Creadora', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(join(dir, 'autora.md'), ['---', 'type: creator', 'name: Autora', '---', '', 'Bio.', ''].join('\n'), 'utf8');
      await writeFile(
        join(dir, 'coleccion.md'),
        ['---', 'title: Antología', 'type: collection', 'files:', '  - test.md', '---', '', 'Intro.', ''].join('\n'),
        'utf8',
      );
      process.exitCode = 0;
      await runBuild(dir);
      expect(process.exitCode).toBe(0);
      const documento = await Bun.file(join(dir, 'dist', 'files', 'test-document.html')).text();
      expect(documento, 'un file sin type dice Texto').toMatch(/>\s*Texto\s*<\/h2>/);
      const collection = await Bun.file(join(dir, 'dist', 'files', 'antologia.html')).text();
      expect(collection).toMatch(/>\s*Colección\s*<\/h2>/);
      const creator = await Bun.file(join(dir, 'dist', 'files', 'autora.html')).text();
      expect(creator).toMatch(/>\s*Creadora\s*<\/h2>/);
      // el chip «Contenido» ya no existe: la banda nombra cada type por su nombre
      expect(documento).not.toContain('>Contenido</h2>');
    });
  });

  it('los campos de portada de la tarjeta de título se renderizan como markdown (#2487)', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(
        join(dir, 'coleccion.md'),
        [
          '---',
          'title: Antología',
          'type: collection',
          "collectionCreatorPrefix: '*Edición*'",
          "subject: '**Ensayo** y `código`'",
          'files:',
          '  - test.md',
          '---',
          '',
          'Intro.',
          '',
        ].join('\n'),
        'utf8',
      );
      process.exitCode = 0;
      await runBuild(dir);
      expect(process.exitCode).toBe(0);
      const collection = await Bun.file(join(dir, 'dist', 'files', 'antologia.html')).text();
      // el markdown de los campos se renderiza, como en la portada del PDF: la
      // `&` de las clases arbitrarias no llega al CSS compilado, pero aquí lo que
      // se lee es el HTML que emite el template
      expect(collection, 'la cursiva del prefijo').toContain('<em>Edición</em>');
      expect(collection, 'la negrita y el código del asunto').toContain('<strong>Ensayo</strong>');
      expect(collection).toContain('<code>código</code>');
      expect(collection, 'y no se ven los asteriscos ni las comillas').not.toContain('*Edición*');
      expect(collection).not.toContain('**Ensayo**');
    });
  });
});
