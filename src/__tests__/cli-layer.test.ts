import { afterEach, beforeAll, describe, expect, it, spyOn } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CommanderError } from 'commander';
import { resolvePdfCheckBinary, validatePdfX1a } from '../builder/pdfx-check.js';
import { reportBuildError, runBuild, runClean, runDoctor, runFilters, runInit, runNew, runValidate } from '../cli/dispatcher.js';
import { checkLatexEngine, checkReadPermissions, checkWritePermissions } from '../cli/doctor/system-checks.js';
import { buildProgram } from '../cli/parser.js';
import { PANDOC_ERROR_CODES, PandocError } from '../lib/errors.js';
import { logWarning, setLoggerColorEnabled } from '../lib/logger.js';
import * as pandocRunner from '../lib/pandoc-runner.js';
import { getPandocVersion } from '../lib/pandoc-runner.js';
import { ProcessSpawnError } from '../lib/run.js';
import { initTestProject, registerSkip, SKIP_REASONS, withTempDir } from './helpers.js';

// Los tests que invocan pandoc real se marcan como skip si no está instalado
// (mismo patrón que integration.test.ts): sin pandoc la suite pasa con skips.
const pandocOk = await getPandocVersion().catch(() => null);
if (!pandocOk) registerSkip('cli-layer.test.ts', SKIP_REASONS.pandoc);
// unzip se usa para inspeccionar EPUBs generados: skip real si no está en PATH.
const unzipOk = (await Bun.which('unzip')) !== null;

// La suite aserta strings exactos de la salida: la colorización ANSI se fuerza
// off aunque el stream sea un TTY (los asserts no dependen del entorno).
beforeAll(() => setLoggerColorEnabled(false));

// El smoke de PDF real solo corre si el motor LaTeX está disponible.
const latexOk = (await checkLatexEngine()).ok;

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

  it('--help sale íntegro en español (opciones de ayuda y versión traducidas)', async () => {
    const stdoutSpy = spyOn(process.stdout, 'write');
    let output = '';
    try {
      // exitOverride hace que --help lance CommanderError (helpDisplayed)
      await buildProgram()
        .parseAsync(['bun', 'bin.ts', '--help'])
        .catch(() => {});
    } finally {
      output = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
      stdoutSpy.mockRestore();
    }
    expect(output).toContain('muestra la ayuda');
    expect(output).toContain('muestra la versión');
    expect(output).not.toContain('display help for command');
    expect(output).not.toContain('output the version number');
  });

  it('el comando help se lista en español', async () => {
    const stdoutSpy = spyOn(process.stdout, 'write');
    let output = '';
    try {
      await buildProgram()
        .parseAsync(['bun', 'bin.ts', '--help'])
        .catch(() => {});
    } finally {
      output = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
      stdoutSpy.mockRestore();
    }
    expect(output).toContain('help [comando]');
    expect(output).toContain('muestra la ayuda de un comando');
  });

  it('el help raíz muestra el slogan, el ejemplo rápido y el enlace a docs', async () => {
    const stdoutSpy = spyOn(process.stdout, 'write');
    let output = '';
    try {
      await buildProgram()
        .parseAsync(['bun', 'bin.ts', '--help'])
        .catch(() => {});
    } finally {
      output = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
      stdoutSpy.mockRestore();
    }
    expect(output).toContain('escribir, compartir, re-existir');
    expect(output).toContain('iteraciones init');
    expect(output).toContain('iteraciones new posts/doc.md');
    expect(output).toContain('iteraciones build');
    expect(output).toContain('docs/configuration.md');
    expect(output).toContain('docs/ejemplos.md');
    expect(output).toContain('list-filters');
    // La descripción no se duplica (bloque 'before' + .description() de commander)
    expect(output.match(/Construye documentos HTML/g)?.length).toBe(1);
    // El bloque 'before' no empieza con una línea en blanco
    expect(output.startsWith('escribir, compartir, re-existir')).toBe(true);
  });

  it('el help de subcomandos muestra --project-root (opción global visible)', async () => {
    const stdoutSpy = spyOn(process.stdout, 'write');
    let output = '';
    try {
      await buildProgram()
        .parseAsync(['bun', 'bin.ts', 'build', '--help'])
        .catch(() => {});
    } finally {
      output = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
      stdoutSpy.mockRestore();
    }
    expect(output).toContain('--project-root');
    expect(output).toContain('directorio raíz del proyecto');
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

  it('--output fuera del proyecto produce mensaje amigable sin stack trace', async () => {
    process.exitCode = 0;
    const output = await parseWithStderr(['build', '--output', '../fuera']);
    expect(output).toContain('--output no puede apuntar fuera del proyecto');
    expect(output).not.toContain('at <anonymous>');
    expect(process.exitCode).toBe(1);
  });
});

describe('--project-root inexistente (mensajes accionables)', () => {
  afterEach(resetExitCode);

  const missingRoot = (suffix: string): string => join(tmpdir(), `no-existe-${suffix}-${Date.now()}`);

  async function runWithStderr(fn: () => Promise<void>): Promise<string> {
    const stderrSpy = spyStderr();
    let output = '';
    try {
      process.exitCode = 0;
      await fn();
    } finally {
      output = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
      stderrSpy.mockRestore();
    }
    return output;
  }

  it('build falla con mensaje accionable (sin ENOENT crudo)', async () => {
    const output = await runWithStderr(() => runBuild(missingRoot('build')));
    expect(output).toContain('no existe');
    expect(output).not.toContain('ENOENT');
    expect(process.exitCode).toBe(1);
  });

  it('validate falla con mensaje accionable', async () => {
    const output = await runWithStderr(() => runValidate(missingRoot('validate')));
    expect(output).toContain('no existe');
    expect(process.exitCode).toBe(1);
  });

  it('doctor falla con mensaje accionable (no "sin permisos")', async () => {
    const output = await runWithStderr(() => runDoctor(missingRoot('doctor')));
    expect(output).toContain('no existe');
    expect(output).not.toContain('sin permisos');
    expect(process.exitCode).toBe(1);
  });

  it('init falla con mensaje accionable', async () => {
    const output = await runWithStderr(() => runInit(missingRoot('init')));
    expect(output).toContain('no existe');
    expect(process.exitCode).toBe(1);
  });

  it('new falla con mensaje accionable', async () => {
    const output = await runWithStderr(() => runNew(missingRoot('new'), 'doc.md'));
    expect(output).toContain('no existe');
    expect(process.exitCode).toBe(1);
  });

  it('clean falla con mensaje accionable', async () => {
    const output = await runWithStderr(() => runClean(missingRoot('clean')));
    expect(output).toContain('no existe');
    expect(process.exitCode).toBe(1);
  });

  it('list-filters falla con mensaje accionable', async () => {
    const output = await runWithStderr(() => runFilters(missingRoot('filters')));
    expect(output).toContain('no existe');
    expect(process.exitCode).toBe(1);
  });

  it('los checks de permisos distinguen inexistencia de EACCES', async () => {
    const root = missingRoot('checks');
    const read = await checkReadPermissions(root);
    const write = await checkWritePermissions(root);
    expect(read.ok).toBe(false);
    expect(read.detail).toContain('no existe');
    expect(write.ok).toBe(false);
    expect(write.detail).toContain('no existe');
  });
});

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

  it('el resumen muestra la razón de invalidación en modo default (y "sin invalidaciones" con caché completa)', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      process.exitCode = 0;
      await runBuild(dir);

      // Caché completa: el resumen lo dice explícitamente en modo default
      let stdoutSpy = spyOn(process.stdout, 'write');
      let out = '';
      try {
        process.exitCode = 0;
        await runBuild(dir);
      } finally {
        out = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
        stdoutSpy.mockRestore();
      }
      expect(out).toContain('(todos reutilizados)');

      // Configuración HTML modificada: la razón aparece plegada en la línea de documentos
      await writeFile(
        join(dir, 'iteraciones.config.yaml'),
        'language: es-MX\nformat:\n  html:\n    site:\n      title: Otro\n    generate: true\n',
        'utf8',
      );
      stdoutSpy = spyOn(process.stdout, 'write');
      out = '';
      try {
        process.exitCode = 0;
        await runBuild(dir);
      } finally {
        out = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
        stdoutSpy.mockRestore();
      }
      expect(process.exitCode).toBe(0);
      expect(out).toMatch(/Documentos\s+1 — configuración HTML/);
      expect(out).not.toContain('(todos reutilizados)');
      expect(out).not.toContain('reprocesados');
    });
  });

  it('build --json imprime el resultado como JSON válido en stdout y nada más', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      const stdoutSpy = spyOn(process.stdout, 'write');
      let out = '';
      try {
        process.exitCode = 0;
        await runBuild(dir, { json: true });
      } finally {
        out = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
        stdoutSpy.mockRestore();
      }
      expect(process.exitCode).toBe(0);
      // Solo el objeto JSON en stdout: sin filas de progreso ni resumen humano
      const parsed = JSON.parse(out.trim()) as {
        processed: number;
        cached: number;
        formats: string[];
        outputDir: string;
        durationMs: number;
        invalidations: string[];
      };
      expect(parsed.processed).toBe(1);
      expect(parsed.cached).toBe(0);
      expect(parsed.formats).toEqual(['html']);
      expect(parsed.outputDir).toBe(join(dir, 'dist', 'files'));
      expect(typeof parsed.durationMs).toBe('number');
      expect(parsed.invalidations).toEqual(['documentos modificados']);
    });
  });

  it('build --json con error emite un objeto JSON con el error y exit 1', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(join(dir, 'roto.md'), '---\ntitle: "sin cerrar\n---\n\nContenido.\n', 'utf8');
      const stdoutSpy = spyOn(process.stdout, 'write');
      const stderrSpy = spyStderr();
      let out = '';
      try {
        process.exitCode = 0;
        await runBuild(dir, { json: true });
      } finally {
        out = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
        stdoutSpy.mockRestore();
        stderrSpy.mockRestore();
      }
      expect(process.exitCode).toBe(1);
      const parsed = JSON.parse(out.trim()) as { error: string };
      expect(typeof parsed.error).toBe('string');
      expect(parsed.error).toContain('frontmatter YAML inválido');
    });
  });

  it('--json y --verbose son mutuamente excluyentes', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      const stderrSpy = spyStderr();
      let output = '';
      try {
        process.exitCode = 0;
        await runBuild(dir, { json: true, verbose: true });
      } finally {
        output = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
        stderrSpy.mockRestore();
      }
      expect(process.exitCode).toBe(1);
      expect(output).toContain('--json y --verbose son mutuamente excluyentes');
    });
  });

  it('termina con exit 1 con --output fuera del proyecto y contexto [build]', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      const stderrSpy = spyStderr();
      let output = '';
      try {
        process.exitCode = 0;
        await runBuild(dir, { outputDir: '../fuera' });
      } finally {
        output = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
        stderrSpy.mockRestore();
      }
      expect(process.exitCode).toBe(1);
      expect(output).toContain('✖ [build] --output');
    });
  });

  it('un cambio de directorio de salida entre builds regenera los documentos (regresión caché --output)', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      process.exitCode = 0;
      await runBuild(dir); // build inicial en dist/files
      expect(process.exitCode).toBe(0);
      expect(await Bun.file(join(dir, 'dist', 'files', 'test-document.html')).exists()).toBe(true);

      // Mismo contenido, distinto directorio: la caché no puede dejar salida2 sin documentos
      process.exitCode = 0;
      await runBuild(dir, { outputDir: 'salida2' });
      expect(process.exitCode).toBe(0);
      expect(await Bun.file(join(dir, 'salida2', 'test-document.html')).exists()).toBe(true);

      // Variante inversa: volver al directorio por defecto tras un --output previo
      process.exitCode = 0;
      await runBuild(dir);
      expect(process.exitCode).toBe(0);
      expect(await Bun.file(join(dir, 'dist', 'files', 'test-document.html')).exists()).toBe(true);
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
      expect(output).toContain("ejecuta 'iteraciones validate' para más detalle");
      expect(process.exitCode).toBe(1);
    });
  });

  it('sin pandoc en PATH, el build aborta al inicio con mensaje accionable', async () => {
    const spy = spyOn(pandocRunner, 'getPandocVersion').mockRejectedValue(
      new (class extends Error {
        sourcePath = '';
        stderr = '';
      })('pandoc no está disponible en PATH. Instálalo desde https://pandoc.org/installing.html'),
    );
    const stderrSpy = spyStderr();
    let output = '';
    try {
      await withTempDir(async (dir) => {
        await initTestProject(dir);
        process.exitCode = 0;
        await runBuild(dir);
      });
    } finally {
      output = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
      stderrSpy.mockRestore();
      spy.mockRestore();
    }
    expect(process.exitCode).toBe(1);
    expect(output).toContain('pandoc no está disponible en PATH');
    expect(output).toContain('https://pandoc.org/installing.html');
  });

  it('un build con frontmatter YAML inválido aborta antes de invocar pandoc', async () => {
    const pandocSpy = spyOn(pandocRunner, 'execPandoc');
    try {
      await withTempDir(async (dir) => {
        await initTestProject(dir);
        await writeFile(join(dir, 'roto.md'), '---\ntitle: "Roto"\ninvalid: [unclosed\n---\n\nContenido.\n', 'utf8');
        process.exitCode = 0;
        await runBuild(dir);
        expect(process.exitCode).toBe(1);
      });
    } finally {
      pandocSpy.mockRestore();
    }
    // La validación ocurre en discover, antes del pipeline: pandoc nunca se invoca.
    expect(pandocSpy).not.toHaveBeenCalled();
  });

  it('lua-filters inexistente emite exactamente un warning en build y en validate (#2011)', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(join(dir, 'iteraciones.config.yaml'), 'language: es-MX\nlua-filters: [filters/no-existe.lua]\n', 'utf8');
      // La advertencia del resumen del build pasa por el tracker (stdout);
      // validate la emite directo a stderr.
      const stdoutSpy = spyOn(process.stdout, 'write');
      let buildOutput = '';
      try {
        process.exitCode = 0;
        await runBuild(dir);
      } finally {
        buildOutput = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
        stdoutSpy.mockRestore();
      }
      expect(process.exitCode).toBe(0);
      const buildWarnings = buildOutput.split('no encontrado en el proyecto').length - 1;
      expect(buildWarnings).toBe(1);

      const validateSpy = spyStderr();
      let validateOutput = '';
      try {
        process.exitCode = 0;
        await runValidate(dir);
      } finally {
        validateOutput = validateSpy.mock.calls.map((c) => String(c[0])).join('');
        validateSpy.mockRestore();
      }
      expect(process.exitCode).toBe(0);
      const validateWarnings = validateOutput.split('no encontrado en el proyecto').length - 1;
      expect(validateWarnings).toBe(1);
    });
  });

  it('un error de pandoc no sugiere validate (no es un problema de config/frontmatter)', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(join(dir, 'iteraciones.config.yaml'), 'language: es-MX\nlua-filters: [filters/roto.lua]\n', 'utf8');
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
      expect(output).not.toContain("ejecuta 'iteraciones validate'");
      expect(process.exitCode).toBe(1);
    });
  });

  it('un page-number inválido se reporta como error de config con la ruta del campo (sin stack trace)', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(join(dir, 'iteraciones.config.yaml'), 'language: es-MX\nformat:\n  pdf:\n    generate: true\n    page-number: raro\n', 'utf8');
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

  it('un slug manual del frontmatter se respeta en las salidas', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(join(dir, 'test.md'), '---\ntitle: Test Document\nslug: mi-url-fija\n---\n\nContenido.\n', 'utf8');
      process.exitCode = 0;
      await runBuild(dir);
      expect(process.exitCode).toBe(0);
      expect(await Bun.file(join(dir, 'dist', 'files', 'mi-url-fija.html')).exists()).toBe(true);
      expect(await Bun.file(join(dir, 'dist', 'files', 'test-document.html')).exists()).toBe(false);
    });
  });

  it('el frontmatter language sobreescribe el de la configuración en HTML, EPUB y Markdown', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir); // config sin language → es-MX por defecto
      // Habilitar los tres formatos ligeros: el contrato de idioma es común
      await writeFile(
        join(dir, 'iteraciones.config.yaml'),
        [
          'language: es-MX',
          'format:',
          '  html:',
          '    site:',
          '      title: Test',
          '    generate: true',
          '  epub:',
          '    generate: true',
          '  markdown:',
          '    generate: true',
        ].join('\n'),
        'utf8',
      );
      await writeFile(join(dir, 'test.md'), '---\ntitle: Test Document\nlanguage: en\n---\n\nContenido.\n', 'utf8');
      process.exitCode = 0;
      await runBuild(dir);
      expect(process.exitCode).toBe(0);
      const html = await Bun.file(join(dir, 'dist', 'files', 'test-document.html')).text();
      expect(html).toContain('<html lang="en"');
      // Contrato unificado (#2010): el mismo campo gobierna EPUB y export Markdown
      expect(await Bun.file(join(dir, 'dist', 'files', 'test-document.epub')).exists()).toBe(true);
      expect(await Bun.file(join(dir, 'dist', 'files', 'test-document.md')).exists()).toBe(true);
    });
  });

  it('el frontmatter lang es un campo ignorado (contrato unificado en language)', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(join(dir, 'test.md'), '---\ntitle: Test Document\nlang: en\n---\n\nContenido.\n', 'utf8');
      const stderrSpy = spyStderr();
      let output = '';
      try {
        process.exitCode = 0;
        await runValidate(dir);
      } finally {
        output = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
        stderrSpy.mockRestore();
      }
      expect(process.exitCode).toBe(0);
      expect(output).toContain('campos de frontmatter ignorados por el pipeline: lang');
    });
  });

  it('el frontmatter toc activa el TOC sin configuración y lo desactiva con ella', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir); // toc: false por defecto
      await writeFile(join(dir, 'test.md'), '---\ntitle: Test Document\ntoc: true\n---\n\n# Sección\n\nContenido.\n', 'utf8');
      process.exitCode = 0;
      await runBuild(dir);
      expect(process.exitCode).toBe(0);
      const conToc = await Bun.file(join(dir, 'dist', 'files', 'test-document.html')).text();
      expect(conToc).toContain('<nav');
      expect(conToc).toContain('id="TOC"');

      // Config con toc: true y frontmatter toc: false → sin TOC en ese documento
      await writeFile(join(dir, 'iteraciones.config.yaml'), 'language: es-MX\ntoc: true\n', 'utf8');
      await writeFile(join(dir, 'test.md'), '---\ntitle: Test Document\ntoc: false\n---\n\n# Sección\n\nContenido.\n', 'utf8');
      process.exitCode = 0;
      await runBuild(dir);
      expect(process.exitCode).toBe(0);
      const sinToc = await Bun.file(join(dir, 'dist', 'files', 'test-document.html')).text();
      expect(sinToc).not.toContain('id="TOC"');
    });
  });

  it('show-date false con date en el frontmatter: la portada del .tex no muestra fecha', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(
        join(dir, 'iteraciones.config.yaml'),
        'language: es-MX\nformat:\n  latex:\n    generate: true\n  pdf:\n    generate: false\n    show-date: false\n',
        'utf8',
      );
      await writeFile(join(dir, 'test.md'), '---\ntitle: Test Document\ndate: 2026-01-01\n---\n\nContenido.\n', 'utf8');
      process.exitCode = 0;
      await runBuild(dir);
      expect(process.exitCode).toBe(0);
      const tex = await Bun.file(join(dir, 'dist', 'files', 'test-document.tex')).text();
      expect(tex).toContain('\\date{}');
      expect(tex).not.toContain('1 de enero de 2026');
    });
  });

  it('un documento sin frontmatter usa \\title{Sin título} en LaTeX', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(join(dir, 'iteraciones.config.yaml'), 'language: es-MX\nformat:\n  latex:\n    generate: true\n', 'utf8');
      await writeFile(join(dir, 'test.md'), 'Contenido sin frontmatter.\n', 'utf8');
      process.exitCode = 0;
      await runBuild(dir);
      expect(process.exitCode).toBe(0);
      const tex = await Bun.file(join(dir, 'dist', 'files', 'test.tex')).text();
      expect(tex).toContain('\\title{Sin título}');
    });
  });

  it('un title no-texto es un error de build (paridad con validate)', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(join(dir, 'malo.md'), '---\ntitle: 123\n---\n\n# Hola\n', 'utf8');
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
      expect(output).toContain('malo.md');
      expect(output).toContain('debe ser un texto (string), se recibió number');
      expect(output).not.toContain('no tiene título');
      // El YAML es válido: el rótulo no debe decir "YAML inválido" y la
      // sugerencia de validate es para errores de sintaxis (issue #1920)
      expect(output).toContain('✖ [build] frontmatter inválido en 1 documento:');
      expect(output).not.toContain('frontmatter YAML inválido');
      expect(output).not.toContain("ejecuta 'iteraciones validate'");
    });
  });

  it('con sintaxis YAML rota y campos inválidos el build separa los bloques por clase', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(join(dir, 'roto.md'), '---\ntitle: "sin cerrar\n---\n\nContenido.\n', 'utf8');
      await writeFile(join(dir, 'malo.md'), '---\ntitle: 123\n---\n\n# Hola\n', 'utf8');
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
      // Cada clase con su rótulo y su detalle (el glifo solo antecede a la
      // primera línea del mensaje multi-bloque)
      expect(output).toContain('✖ [build] frontmatter YAML inválido en 1 documento:');
      expect(output).toContain('roto.md:');
      expect(output).toContain('frontmatter inválido en 1 documento:');
      expect(output).toContain('malo.md:');
      // Hay sintaxis rota: la sugerencia de validate sí aplica
      expect(output).toContain("ejecuta 'iteraciones validate'");
    });
  });

  it('bibliography configurada e inexistente falla el build (paridad con validate)', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(join(dir, 'iteraciones.config.yaml'), 'bibliography: refs/no-existe.bib\n', 'utf8');
      const stderrSpy = spyStderr();
      let buildOutput = '';
      try {
        process.exitCode = 0;
        await runBuild(dir);
      } finally {
        buildOutput = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
        stderrSpy.mockRestore();
      }
      expect(process.exitCode).toBe(1);
      expect(buildOutput).toContain('bibliography: "refs/no-existe.bib" no encontrado en el proyecto');

      // validate falla con el mismo texto del problema
      const vSpy = spyStderr();
      let validateOutput = '';
      try {
        process.exitCode = 0;
        await runValidate(dir);
      } finally {
        validateOutput = vSpy.mock.calls.map((c) => String(c[0])).join('');
        vSpy.mockRestore();
      }
      expect(process.exitCode).toBe(1);
      expect(validateOutput).toContain('bibliography: "refs/no-existe.bib" no encontrado en el proyecto');
    });
  });

  it('claves desconocidas en config fallan el build igual que validate', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(join(dir, 'iteraciones.config.yaml'), 'clave-inventada: 1\n', 'utf8');
      const stderrSpy = spyStderr();
      let buildOutput = '';
      try {
        process.exitCode = 0;
        await runBuild(dir);
      } finally {
        buildOutput = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
        stderrSpy.mockRestore();
      }
      expect(process.exitCode).toBe(1);
      expect(buildOutput).toContain('claves desconocidas');
      expect(buildOutput).toContain('clave-inventada');
    });
  });

  it('build falla sin iteraciones.config.yaml sugiriendo init (#2071)', async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, 'doc.md'), '---\ntitle: Doc\ndate: 2026-01-01\n---\n\nTexto.\n', 'utf8');
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
      expect(output).toContain('falta el archivo de configuración');
      expect(output).toContain("ejecuta 'iteraciones init'");
    });
  });

  it('el frontmatter con date no ISO y campos ignorados advierte en build y en validate (mismos warnings)', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(join(dir, 'test.md'), '---\ntitle: Ok\ndate: 2026/01/01\ncampo-raro: x\n---\n\nContenido.\n', 'utf8');
      // build: warnings en el resumen (stdout) sin romper
      const stdoutSpy = spyOn(process.stdout, 'write');
      let buildOutput = '';
      try {
        process.exitCode = 0;
        await runBuild(dir);
      } finally {
        buildOutput = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
        stdoutSpy.mockRestore();
      }
      expect(process.exitCode).toBe(0);
      expect(buildOutput).toContain('date" no usa el formato ISO');
      expect(buildOutput).toContain('campos de frontmatter ignorados');

      // validate: mismos warnings, exit 0
      const vSpy = spyStderr();
      let validateOutput = '';
      try {
        process.exitCode = 0;
        await runValidate(dir);
      } finally {
        validateOutput = vSpy.mock.calls.map((c) => String(c[0])).join('');
        vSpy.mockRestore();
      }
      expect(process.exitCode).toBe(0);
      expect(validateOutput).toContain('date" no usa el formato ISO');
      expect(validateOutput).toContain('campos de frontmatter ignorados');
    });
  });

  it('el warning de ":" suelta en el cuerpo se emite en build y validate (mismo contrato)', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(join(dir, 'suelta.md'), '---\ntitle: Ok\n---\n\ntexto\n\n:\n\ntexto\n', 'utf8');
      // build: warning en el resumen (stdout) sin romper
      const stdoutSpy = spyOn(process.stdout, 'write');
      let buildOutput = '';
      try {
        process.exitCode = 0;
        await runBuild(dir);
      } finally {
        buildOutput = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
        stdoutSpy.mockRestore();
      }
      expect(process.exitCode).toBe(0);
      expect(buildOutput).toContain('suelta.md');
      expect(buildOutput).toContain('línea 7 con ":" suelta');
      expect(buildOutput).toContain('"::" (espacio vertical) o ":;" (sin indentación)');

      // validate: mismos warnings, exit 0
      const vSpy = spyStderr();
      let validateOutput = '';
      try {
        process.exitCode = 0;
        await runValidate(dir);
      } finally {
        validateOutput = vSpy.mock.calls.map((c) => String(c[0])).join('');
        vSpy.mockRestore();
      }
      expect(process.exitCode).toBe(0);
      expect(validateOutput).toContain('suelta.md');
      expect(validateOutput).toContain('línea 7 con ":" suelta');
      expect(validateOutput).toContain('"::" (espacio vertical) o ":;" (sin indentación)');
    });
  });

  it('el warning de documento sin título se emite en build y validate (mismo contrato)', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(join(dir, 'sin-titulo.md'), '---\ndate: 2026-01-01\n---\n\nContenido.\n', 'utf8');
      // build: warning en el resumen (stdout) sin romper
      const stdoutSpy = spyOn(process.stdout, 'write');
      let buildOutput = '';
      try {
        process.exitCode = 0;
        await runBuild(dir);
      } finally {
        buildOutput = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
        stdoutSpy.mockRestore();
      }
      expect(process.exitCode).toBe(0);
      expect(buildOutput).toContain('sin-titulo.md: no tiene título en el frontmatter; se usará "Sin título"');

      // validate: mismo warning (mismo texto), exit 0
      const vSpy = spyStderr();
      let validateOutput = '';
      try {
        process.exitCode = 0;
        await runValidate(dir);
      } finally {
        validateOutput = vSpy.mock.calls.map((c) => String(c[0])).join('');
        vSpy.mockRestore();
      }
      expect(process.exitCode).toBe(0);
      expect(validateOutput).toContain('sin-titulo.md: no tiene título en el frontmatter; se usará "Sin título"');
    });
  });

  it('title-image: ruta absoluta en el tex con el guion bajo sin escapar', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(join(dir, 'iteraciones.config.yaml'), 'language: es-MX\nformat:\n  latex:\n    generate: true\n', 'utf8');
      // PNG 1x1 válido (base64)
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
      await writeFile(join(dir, 'mi_portada.png'), png);
      await writeFile(join(dir, 'test.md'), '---\ntitle: Test Document\ntitle-image: ./mi_portada.png\n---\n\nContenido.\n', 'utf8');
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

  it('title-image: archivo inexistente falla con mensaje claro (no el de latexmk)', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(join(dir, 'iteraciones.config.yaml'), 'language: es-MX\nformat:\n  latex:\n    generate: true\n', 'utf8');
      await writeFile(join(dir, 'test.md'), '---\ntitle: Test Document\ntitle-image: ./no_existe.png\n---\n\nContenido.\n', 'utf8');
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
      expect(output).toContain('title-image no encontrado');
      expect(output).toContain(join(dir, 'no_existe.png'));
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

  it('un documento sin cuerpo se omite con warning (no aborta el build)', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(join(dir, 'vacio.md'), '---\ntitle: Vacío\n---\n', 'utf8');
      await writeFile(join(dir, 'hueco.md'), '', 'utf8');
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
      expect(output).toContain('vacio.md');
      expect(output).toContain('no tiene contenido después del frontmatter; se omite del build');
      expect(output).toContain('hueco.md');
      expect(output).toContain('está vacío; se omite del build');
      // El documento válido sí se genera (slug derivado del título)
      expect(await Bun.file(join(dir, 'dist', 'files', 'test-document.html')).exists()).toBe(true);
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
      await writeFile(join(dir, 'iteraciones.config.yaml'), 'language: es-MX\nlua-filters: [filters/roto.lua]\n', 'utf8');
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
      const cssPath = join(dir, 'dist', 'files', 'css', 'styles.css');
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
      expect(html).toContain('<h1 id="referencias">Referencias</h1>');
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
      expect(html).toContain('<h1 id="referencias">Referencias</h1>');
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
      expect(html).toContain('<h1 id="sección">Sección</h1>');
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
      // La tarjeta Formatos va después de la tarjeta de contenido
      expect(html.indexOf('>Formatos</h2>')).toBeGreaterThan(html.indexOf('<article'));
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

  it('el masonry sigue el orden de bloques por defecto (header, contenido, formatos, indice, referencias, footer)', async () => {
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
      expect(pos('Tarjeta identidad')).toBeLessThan(pos('<article')); // contenido
      expect(pos('<article')).toBeLessThan(pos('>Formatos</h2>'));
      expect(pos('>Formatos</h2>')).toBeLessThan(pos('id="TOC"'));
      expect(pos('id="TOC"')).toBeLessThan(pos('id="refs-heading"'));
      expect(pos('id="refs-heading"')).toBeLessThan(html.lastIndexOf('class="break-inside-avoid pb-6"')); // footer
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
      expect(pos('>Formatos</h2>')).toBeGreaterThan(pos('id="TOC"'));
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
      expect(html).not.toContain('>Formatos</h2>');
      expect(html).not.toContain('id="TOC"');
      expect(html).not.toContain('refs-heading');
      const pos = (s: string): number => html.indexOf(s);
      expect(pos('Tarjeta identidad')).toBeLessThan(pos('<article'));
      expect(pos('<article')).toBeLessThan(html.lastIndexOf('class="break-inside-avoid pb-6"'));
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

  it('el chip del contenido dice Contenido', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      process.exitCode = 0;
      await runBuild(dir);
      expect(process.exitCode).toBe(0);
      const html = await Bun.file(join(dir, 'dist', 'files', 'test-document.html')).text();
      expect(html).toContain('>Contenido</h2>');
      expect(html).not.toContain('>Trayectura</h2>');
      expect(html).not.toContain('>Trayectoria</h2>');
    });
  });
});

describe('doctor --info (antes runInfo)', () => {
  afterEach(resetExitCode);

  /** Ejecuta doctor --info y captura stdout. */
  async function infoOutput(dir: string): Promise<string> {
    const stdoutSpy = spyOn(process.stdout, 'write');
    let output = '';
    try {
      process.exitCode = 0;
      await runDoctor(dir, { info: true });
    } finally {
      output = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
      stdoutSpy.mockRestore();
    }
    return output;
  }

  it.skipIf(!pandocOk)('refleja el directorio de salida real del último build', async () => {
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

  it('distingue preamble desactivados de la config de los defaults del paquete', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(
        join(dir, 'iteraciones.config.yaml'),
        'language: es-MX\nformat:\n  pdf:\n    disabled-preamble-filters:\n      - 19-maketitle\n',
        'utf8',
      );
      const output = await infoOutput(dir);
      expect(output).toContain('filters de preámbulo desactivados (config):');
      expect(output).toContain('19-maketitle');
      expect(output).toContain('filters de preámbulo desactivados (defaults del paquete):');
      expect(output).toContain('97-eso-pic, 98-crop, 99-pdfx');
    });
  });

  it('clave escrita con valor idéntico al default aparece como config (sin sustracción)', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      // 97-eso-pic es un default del paquete: la sustracción anterior lo
      // ocultaba de la línea de config; la presencia en el YAML lo hace visible.
      await writeFile(
        join(dir, 'iteraciones.config.yaml'),
        'language: es-MX\nformat:\n  pdf:\n    disabled-preamble-filters:\n      - 97-eso-pic\n',
        'utf8',
      );
      const output = await infoOutput(dir);
      const configLine = output.split('\n').find((l) => l.includes('filters de preámbulo desactivados (config):'));
      expect(configLine).toBeDefined();
      expect(configLine).toContain('97-eso-pic');
      expect(configLine).not.toContain('(ninguno)');
    });
  });

  it('sin desactivaciones de usuario, la línea de config muestra (ninguno) y la de defaults los del paquete', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      const output = await infoOutput(dir);
      // La columna de valores la fija la etiqueta más larga (padEnd): la línea
      // de config alinea su valor con la de defaults del paquete.
      const configLabel = 'filters de preámbulo desactivados (config):';
      const defaultsLabel = 'filters de preámbulo desactivados (defaults del paquete):';
      expect(output).toContain(`${configLabel.padEnd(defaultsLabel.length)} (ninguno)`);
      expect(output).toContain('filters de preámbulo desactivados (defaults del paquete): 97-eso-pic, 98-crop, 99-pdfx');
    });
  });

  it('cada línea del bloque de información lleva el prefijo [doctor]', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      const output = await infoOutput(dir);
      // El prefijo y el glifo se repiten en cada línea (formato unificado)
      const prefixed = output.split('\n').filter((l) => l.includes('language:') || l.includes('toc:') || l.includes('documentos:'));
      expect(prefixed.length).toBeGreaterThanOrEqual(3);
      for (const line of prefixed) {
        expect(line).toContain('[doctor]');
      }
    });
  });
});

describe('runFilters', () => {
  afterEach(resetExitCode);

  it('funciona sin iteraciones.config.yaml mostrando el estado por defecto (#2071)', async () => {
    await withTempDir(async (dir) => {
      const stdoutSpy = spyOn(process.stdout, 'write');
      try {
        process.exitCode = 0;
        runFilters(dir);
      } finally {
        stdoutSpy.mockRestore();
      }
      expect(process.exitCode).toBe(0);
    });
  });

  it('por defecto muestra una línea por filtro: primera oración, ≤100 chars (#2027)', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      const stdoutSpy = spyOn(process.stdout, 'write');
      let output = '';
      try {
        process.exitCode = 0;
        await runFilters(dir, { columns: 400 });
      } finally {
        output = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
        stdoutSpy.mockRestore();
      }
      // Primera oración de latex/02-dictum (la descripción completa sigue en el registro)
      expect(output).toMatch(/latex\/02-dictum {2,}lua {2}Convierte [^\n]*\.[^\n]*\[activo\]/);
      // El detalle largo NO aparece por defecto
      expect(output).not.toContain('si es Para.');
      expect(output).not.toContain('expone el CLI como metadata babel-lang');
    });
  });

  it('--verbose conserva las descripciones completas (#2027)', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      const stdoutSpy = spyOn(process.stdout, 'write');
      let output = '';
      try {
        process.exitCode = 0;
        await runFilters(dir, { columns: 400, verbose: true });
      } finally {
        output = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
        stdoutSpy.mockRestore();
      }
      expect(output).toContain('si es Para.');
      expect(output).toContain('expone el CLI como metadata babel-lang');
      expect(output).toContain('sin el texto de información');
      expect(output).toMatch(/latex\/02-dictum {2,}lua {2}Convierte/);
    });
  });

  it('en un TTY estrecho las descripciones se truncan con elipsis (por diseño)', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      const stdoutSpy = spyOn(process.stdout, 'write');
      let output = '';
      try {
        process.exitCode = 0;
        await runFilters(dir, { columns: 40 });
      } finally {
        output = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
        stdoutSpy.mockRestore();
      }
      // Ancho forzado de 40 columnas: las descripciones largas se recortan con …
      expect(output).toContain('…');
      expect(output).not.toContain('si es Para.');
      expect(process.exitCode).toBe(0);
    });
  });
});

describe('runValidate', () => {
  afterEach(resetExitCode);

  it('falla sin iteraciones.config.yaml sugiriendo init (#2071)', async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, 'doc.md'), '---\ntitle: Doc\ndate: 2026-01-01\n---\n\nTexto.\n', 'utf8');
      const stderrSpy = spyStderr();
      let output = '';
      try {
        process.exitCode = 0;
        await runValidate(dir);
      } finally {
        output = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
        stderrSpy.mockRestore();
      }
      expect(process.exitCode).toBe(1);
      expect(output).toContain('falta el archivo de configuración');
      expect(output).toContain("ejecuta 'iteraciones init'");
    });
  });

  it('termina con exit 0 con config válida y documentos con frontmatter', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      process.exitCode = 0;
      await runValidate(dir);
      expect(process.exitCode).toBe(0);
    });
  });

  it('config sin documentos sugiere init (#2089)', async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, 'iteraciones.config.yaml'), 'language: es-MX\n', 'utf8');
      const spy = spyOn(process.stdout, 'write');
      let output = '';
      try {
        process.exitCode = 0;
        await runValidate(dir);
      } finally {
        output = spy.mock.calls.map((c) => String(c[0])).join('');
        spy.mockRestore();
      }
      expect(process.exitCode).toBe(0);
      expect(output).toContain("ejecuta 'iteraciones init'");
    });
  });

  it('advierte sobre documentos vacíos y frontmatter sin cuerpo (exit 0)', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(join(dir, 'vacio.md'), '---\ntitle: Vacío\n---\n', 'utf8');
      await writeFile(join(dir, 'hueco.md'), '', 'utf8');
      const stderrSpy = spyStderr();
      let output = '';
      try {
        process.exitCode = 0;
        await runValidate(dir);
      } finally {
        output = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
        stderrSpy.mockRestore();
      }
      expect(process.exitCode).toBe(0);
      expect(output).toContain('vacio.md');
      expect(output).toContain('no tiene contenido después del frontmatter; se omite');
      expect(output).toContain('hueco.md');
      expect(output).toContain('documento vacío; se omite');
    });
  });

  it('advierte cuando un documento no tiene título en el frontmatter (sin frontmatter, sin clave o title vacío) — exit 0', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(join(dir, 'sin-fm.md'), 'Solo contenido, sin frontmatter.\n', 'utf8');
      await writeFile(join(dir, 'sin-clave.md'), '---\ndate: 2026-01-01\n---\n\nContenido.\n', 'utf8');
      await writeFile(join(dir, 'titulo-vacio.md'), '---\ntitle: ""\n---\n\nContenido.\n', 'utf8');
      const stderrSpy = spyStderr();
      let output = '';
      try {
        process.exitCode = 0;
        await runValidate(dir);
      } finally {
        output = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
        stderrSpy.mockRestore();
      }
      expect(process.exitCode).toBe(0);
      for (const file of ['sin-fm.md', 'sin-clave.md', 'titulo-vacio.md']) {
        expect(output).toContain(`${file}: no tiene título en el frontmatter; se usará "Sin título"`);
      }
    });
  });

  it('termina con exit 1 con YAML de config inválido', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(join(dir, 'iteraciones.config.yaml'), 'format: [mal formado', 'utf8');
      process.exitCode = 0;
      await runValidate(dir);
      expect(process.exitCode).toBe(1);
    });
  });

  it('las causas YAML en inglés se traducen al español y el nombre del archivo no se duplica', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      // Indentación inconsistente: la causa del issue original era "All mapping
      // items must start at the same column"
      await writeFile(join(dir, 'iteraciones.config.yaml'), 'format:\n  html: true\n latex:\n  generate: true\n', 'utf8');
      const stderrSpy = spyStderr();
      let output = '';
      try {
        process.exitCode = 0;
        await runValidate(dir);
      } finally {
        output = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
        stderrSpy.mockRestore();
      }
      // Causa en español, con posición y sin duplicación del nombre del archivo
      expect(output).toContain('✖ [validate] iteraciones.config.yaml: Error de sintaxis: los items del mapeo');
      expect(output).toMatch(/\(línea \d+, columna \d+\)/);
      expect(output.match(/iteraciones\.config\.yaml/g)).toHaveLength(1);
      expect(output).not.toContain('All mapping items');
      expect(process.exitCode).toBe(1);
    });
  });

  it('rechaza tipos incorrectos en campos conocidos del frontmatter (title: 123)', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(join(dir, 'malo.md'), '---\ntitle: 123\n---\n\n# Hola\n', 'utf8');
      const stderrSpy = spyStderr();
      let output = '';
      try {
        process.exitCode = 0;
        await runValidate(dir);
      } finally {
        output = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
        stderrSpy.mockRestore();
      }
      expect(output).toContain('malo.md');
      expect(output).toContain('"title" debe ser un texto');
      expect(process.exitCode).toBe(1);
    });
  });

  it('rechaza un creator que no es texto ni lista de textos', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(join(dir, 'malo.md'), '---\ntitle: "Ok"\ncreator: 5\n---\n\n# Hola\n', 'utf8');
      const stderrSpy = spyStderr();
      let output = '';
      try {
        process.exitCode = 0;
        await runValidate(dir);
      } finally {
        output = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
        stderrSpy.mockRestore();
      }
      expect(output).toContain('"creator" debe ser un texto o una lista de textos');
      expect(process.exitCode).toBe(1);
    });
  });

  it('advierte (exit 0) sobre date con formato no ISO', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(join(dir, 'malo.md'), '---\ntitle: "Ok"\ndate: "no-es-fecha"\n---\n\n# Hola\n', 'utf8');
      const stderrSpy = spyStderr();
      let output = '';
      try {
        process.exitCode = 0;
        await runValidate(dir);
      } finally {
        output = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
        stderrSpy.mockRestore();
      }
      expect(output).toContain('"date" no usa el formato ISO YYYY-MM-DD');
      expect(process.exitCode).toBe(0);
    });
  });

  it('advierte (exit 0) sobre frontmatter sin cerrar', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(join(dir, 'abierto.md'), '---\ntitle: "x"\n\n# Hola\n', 'utf8');
      const stderrSpy = spyStderr();
      let output = '';
      try {
        process.exitCode = 0;
        await runValidate(dir);
      } finally {
        output = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
        stderrSpy.mockRestore();
      }
      expect(output).toContain('frontmatter sin cerrar');
      expect(process.exitCode).toBe(0);
    });
  });

  it('advierte (exit 0) sobre ":" suelta en el cuerpo con sugerencia del vocabulario', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(join(dir, 'suelta.md'), '---\ntitle: "Ok"\n---\n\ntexto\n\n:\n\ntexto\n', 'utf8');
      const stderrSpy = spyStderr();
      let output = '';
      try {
        process.exitCode = 0;
        await runValidate(dir);
      } finally {
        output = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
        stderrSpy.mockRestore();
      }
      expect(process.exitCode).toBe(0);
      expect(output).toContain('suelta.md');
      expect(output).toContain('línea 7 con ":" suelta');
      expect(output).toContain('"::" (espacio vertical) o ":;" (sin indentación)');
    });
  });

  it('no advierte con el vocabulario correcto (::, :; y fenced divs cierran en silencio)', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(join(dir, 'limpio.md'), '---\ntitle: "Ok"\n---\n\ntexto\n\n::\n\ntexto\n\n:;\n\ntexto\n\n::: {.dictum}\nCita\n:::\n', 'utf8');
      const stderrSpy = spyStderr();
      const stdoutSpy = spyOn(process.stdout, 'write');
      let output = '';
      let stdout = '';
      try {
        process.exitCode = 0;
        await runValidate(dir);
      } finally {
        output = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
        stdout = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
        stderrSpy.mockRestore();
        stdoutSpy.mockRestore();
      }
      expect(process.exitCode).toBe(0);
      expect(output).not.toContain('con ":" suelta');
      expect(stdout).toContain('sin errores');
    });
  });

  it('reporta una sola línea de resumen con plural correcto (1 error)', async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, 'iteraciones.config.yaml'), 'language: [inválido\n', 'utf8');
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
      await writeFile(join(dir, 'iteraciones.config.yaml'), 'language: [inválido\n', 'utf8');
      await writeFile(join(dir, 'a.md'), '---\ntitle: [inválido\n---\n', 'utf8');
      const stderrSpy = spyStderr();
      let output = '';
      try {
        process.exitCode = 0;
        await runValidate(dir);
      } finally {
        output = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
        stderrSpy.mockRestore();
      }
      expect(output).toContain('2 errores');
      expect(process.exitCode).toBe(1);
    });
  });

  it('accent inválido no enmascara los demás errores de la config', async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, 'iteraciones.config.yaml'), 'language: 123\nformat:\n  html:\n    site:\n      color: naranja\n', 'utf8');
      const stderrSpy = spyStderr();
      let output = '';
      try {
        process.exitCode = 0;
        await runValidate(dir);
      } finally {
        output = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
        stderrSpy.mockRestore();
      }
      expect(process.exitCode).toBe(1);
      // Ambos errores se reportan en una sola ejecución (antes solo el accent)
      expect(output).toContain('color');
      expect(output).toContain('language');
    });
  });

  it('advierte sobre campos de frontmatter ignorados sin romper el exit code', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(join(dir, 'extra.md'), '---\ntitle: Extra\nabstract: Resumen del trabajo\ncustom-field: valor\n---\n\nContenido.\n', 'utf8');
      const stderrSpy = spyStderr();
      let output = '';
      try {
        process.exitCode = 0;
        await runValidate(dir);
      } finally {
        output = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
        stderrSpy.mockRestore();
      }
      expect(output).toContain('campos de frontmatter ignorados por el pipeline: custom-field');
      expect(output).toContain('extra.md');
      expect(process.exitCode).toBe(0);
    });
  });

  it('no advierte sobre los campos que fluyen a pandoc/template (toc, language, description, etc.)', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(
        join(dir, 'efectivos.md'),
        '---\ntitle: Efectivos\nlanguage: en\ntoc: true\ndescription: Resumen\nsite-title: Mi sitio\ntheme: light\naccent: rose\n---\n\nContenido.\n',
        'utf8',
      );
      const stderrSpy = spyStderr();
      let output = '';
      try {
        process.exitCode = 0;
        await runValidate(dir);
      } finally {
        output = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
        stderrSpy.mockRestore();
      }
      expect(output).not.toContain('campos de frontmatter ignorados');
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
      await writeFile(join(dir, 'iteraciones.config.yaml'), 'language: es-MX\nbibliography: refs/no-existe.bib\n', 'utf8');
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

  it('desactivar 05-language sin 16-toc-styling es un error de dependencia', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(
        join(dir, 'iteraciones.config.yaml'),
        'language: es-MX\nformat:\n  pdf:\n    disabled-preamble-filters:\n      - 05-language\n',
        'utf8',
      );
      const stderrSpy = spyStderr();
      let output = '';
      try {
        process.exitCode = 0;
        await runValidate(dir);
      } finally {
        output = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
        stderrSpy.mockRestore();
      }
      expect(process.exitCode).toBe(1);
      expect(output).toContain('16-toc-styling usa');
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

  it.skipIf(!pandocOk)('no verifica el motor LaTeX cuando el proyecto no usa PDF ni LaTeX', async () => {
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
      await writeFile(join(dir, 'iteraciones.config.yaml'), 'language: es-MX\nformat:\n  pdf:\n    generate: true\n', 'utf8');
      const output = await doctorOutput(dir);
      expect(output).toContain('pdflatex disponible');
    });
  });

  it('pdftoppm ausente se reporta con ⚠ y no rompe el exit code (check opcional)', async () => {
    const runModule = await import('../lib/run.js');
    const realRun = runModule.exec;
    const spy = spyOn(runModule, 'exec').mockImplementation(async (cmd: string, args: string[], opts?: Parameters<typeof runModule.exec>[2]) => {
      if (cmd === 'pdftoppm') throw new runModule.ProcessSpawnError('pdftoppm no encontrado');
      return realRun(cmd, args, opts);
    });
    try {
      await withTempDir(async (dir) => {
        await initTestProject(dir);
        await writeFile(join(dir, 'iteraciones.config.yaml'), 'language: es-MX\nformat:\n  pdf:\n    generate: true\n', 'utf8');
        const output = await doctorOutput(dir);
        // El check opcional falla con ⚠ pero doctor sigue en exit 0
        expect(process.exitCode).toBe(0);
        expect(output).toContain('⚠ pdftoppm disponible');
        expect(output).toContain('Instala poppler');
      });
    } finally {
      spy.mockRestore();
    }
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

  it('crea los cuatro archivos en un directorio vacío (incluye .gitignore)', async () => {
    await withTempDir(async (dir) => {
      process.exitCode = 0;
      await runInit(dir);
      expect(process.exitCode).toBe(0);
      expect(await Bun.file(join(dir, 'iteraciones.config.yaml')).exists()).toBe(true);
      expect(await Bun.file(join(dir, 'index.md')).exists()).toBe(true);
      expect(await Bun.file(join(dir, 'bibliography.bib')).exists()).toBe(true);
      const gitignore = await Bun.file(join(dir, '.gitignore')).text();
      expect(gitignore).toContain('dist/');
      expect(gitignore).toContain('.iteraciones/');
    });
  });

  it('no sobreescribe un .gitignore preexistente', async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, '.gitignore'), 'node_modules/\n', 'utf8');
      process.exitCode = 0;
      await runInit(dir);
      expect(process.exitCode).toBe(0);
      const gitignore = await Bun.file(join(dir, '.gitignore')).text();
      expect(gitignore).toBe('node_modules/\n');
    });
  });

  it.skipIf(!pandocOk)('el primer build tras init produce un index.html real', async () => {
    await withTempDir(async (dir) => {
      process.exitCode = 0;
      await runInit(dir);
      await runBuild(dir);
      expect(process.exitCode).toBe(0);
      expect(await Bun.file(join(dir, 'dist', 'files', 'index.html')).exists()).toBe(true);
      // La tarjeta identidad del resto de documentos enlaza al home
      const html = await Bun.file(join(dir, 'dist', 'files', 'index.html')).text();
      expect(html).toContain('Inicio');
    });
  });

  it('el config generado es mínimo, parsea sin warnings y remite a la documentación', async () => {
    await withTempDir(async (dir) => {
      process.exitCode = 0;
      await runInit(dir);
      const yaml = await Bun.file(join(dir, 'iteraciones.config.yaml')).text();
      expect(yaml).toContain('# Configuración del sitio. Consulta docs/configuration.md');
      expect(yaml).toContain('theme: dark');
      expect(yaml.split('\n').length).toBeLessThanOrEqual(25);
      // El config generado debe pasar validate sin errores
      const stderrSpy = spyStderr();
      let output = '';
      try {
        process.exitCode = 0;
        await runValidate(dir);
      } finally {
        output = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
        stderrSpy.mockRestore();
      }
      expect(output).not.toContain('✖');
      expect(process.exitCode).toBe(0);
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

  it('el config generado omite blocks (los defaults viven en código)', async () => {
    await withTempDir(async (dir) => {
      process.exitCode = 0;
      await runInit(dir);
      expect(process.exitCode).toBe(0);
      const yaml = await Bun.file(join(dir, 'iteraciones.config.yaml')).text();
      const parsed = Bun.YAML.parse(yaml) as { format?: { html?: { blocks?: Record<string, number> } } };
      expect(parsed.format?.html?.blocks).toBeUndefined();
    });
  });
});

describe('huecos transversales (#2032)', () => {
  afterEach(resetExitCode);

  it('state.json corrupto ⇒ rebuild completo sin crash y estado válido después', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      process.exitCode = 0;
      await runBuild(dir); // primer build: caché válida
      expect(process.exitCode).toBe(0);

      // Corromper/truncar el estado a mitad de escritura simulado
      const { writeFile } = await import('node:fs/promises');
      await writeFile(join(dir, '.iteraciones', 'state.json'), '{"startedAt":42,"activeFor', 'utf8');

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
      // Rebuild completo: el documento se procesó, no se sirvió de caché
      expect(output).toMatch(/Documentos\s+1 — documentos modificados/);
      expect(output).not.toContain('Sin cambios');
      // El estado quedó re-escrito válido y completo por la escritura única
      const state = JSON.parse(await Bun.file(join(dir, '.iteraciones', 'state.json')).text());
      expect(state.completed).toBe(true);
      expect(state.schemaVersion).toBe(2);
    });
  });

  it('humo del contrato --json contra docs/architecture.md', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      const stdoutSpy = spyOn(process.stdout, 'write');
      let raw = '';
      try {
        process.exitCode = 0;
        await runBuild(dir, { json: true });
      } finally {
        raw = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
        stdoutSpy.mockRestore();
      }
      expect(process.exitCode).toBe(0);
      // Una única línea en stdout y es JSON válido con EXACTAMENTE las claves documentadas
      const lines = raw
        .trim()
        .split('\n')
        .filter((l) => l.trim() !== '');
      expect(lines.length).toBe(1);
      const parsed = JSON.parse(lines[0] ?? '') as Record<string, unknown>;
      expect(Object.keys(parsed).sort()).toEqual(['cached', 'durationMs', 'formats', 'invalidations', 'outputDir', 'processed'].sort());
      expect(typeof parsed.processed).toBe('number');
      expect(typeof parsed.cached).toBe('number');
      expect(Array.isArray(parsed.formats)).toBe(true);
      expect(typeof parsed.outputDir).toBe('string');
      expect(typeof parsed.durationMs).toBe('number');
      expect(Array.isArray(parsed.invalidations)).toBe(true);
    });
  });
});

describe('runNew', () => {
  afterEach(resetExitCode);

  it('la inferencia conserva los acentos del nombre de archivo (#2088)', async () => {
    await withTempDir(async (dir) => {
      process.exitCode = 0;
      await runNew(dir, 'corazón-profundo');
      expect(process.exitCode).toBe(0);
      const content = await Bun.file(join(dir, 'corazón-profundo.md')).text();
      expect(content).toContain('title: "Corazón Profundo"');
    });
  });

  it('crea un archivo .md con frontmatter mínimo', async () => {
    await withTempDir(async (dir) => {
      process.exitCode = 0;
      await runNew(dir, 'posts/mi-articulo');
      expect(process.exitCode).toBe(0);
      const file = Bun.file(join(dir, 'posts/mi-articulo.md'));
      expect(await file.exists()).toBe(true);
      const content = await file.text();
      expect(content).toContain('title: "Mi Articulo"');
      expect(content).toContain('date:');
    });
  });

  it('capitaliza cada palabra del título inferido (#2036)', async () => {
    await withTempDir(async (dir) => {
      process.exitCode = 0;
      await runNew(dir, 'posts/una-larga-historia.md');
      expect(await Bun.file(join(dir, 'posts/una-larga-historia.md')).text()).toContain('title: "Una Larga Historia"');
      await runNew(dir, 'hola');
      expect(await Bun.file(join(dir, 'hola.md')).text()).toContain('title: "Hola"');
    });
  });

  it('incluye ejemplos del lenguaje (:: y dictum) que el usuario borra', async () => {
    await withTempDir(async (dir) => {
      process.exitCode = 0;
      await runNew(dir, 'con-ejemplos');
      expect(process.exitCode).toBe(0);
      const content = await Bun.file(join(dir, 'con-ejemplos.md')).text();
      expect(content).toContain('::');
      expect(content).toContain('::: {.dictum}');
      // El frontmatter sigue siendo el bloque YAML inicial (los ejemplos van
      // en el cuerpo, nunca dentro del frontmatter)
      const frontmatter = content.split('---')[1] ?? '';
      expect(frontmatter).not.toContain('dictum');
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
      expect(content).toContain('title: "Mi Articulo Nuevo"');
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

  it.skipIf(!pandocOk)('el round-trip new → validate → build funciona con títulos difíciles', async () => {
    await withTempDir(async (dir) => {
      // #2071: validate y build exigen iteraciones.config.yaml
      await writeFile(join(dir, 'iteraciones.config.yaml'), 'language: es-MX\n', 'utf8');
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

  it('rechaza un path sin nombre de archivo (posts/) con mensaje accionable', async () => {
    await withTempDir(async (dir) => {
      process.exitCode = 0;
      const stderrSpy = spyStderr();
      let output = '';
      try {
        await runNew(dir, 'posts/');
      } finally {
        output = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
        stderrSpy.mockRestore();
      }
      expect(process.exitCode).toBe(1);
      expect(await Bun.file(join(dir, 'posts', '.md')).exists()).toBe(false);
      expect(output).toContain('nombre de archivo');
      expect(output).toContain('posts/mi-articulo.md');
    });
  });

  it('rechaza nombres de archivo ocultos (.oculto.md y .)', async () => {
    await withTempDir(async (dir) => {
      process.exitCode = 0;
      await runNew(dir, '.oculto.md');
      expect(process.exitCode).toBe(1);
      expect(await Bun.file(join(dir, '.oculto.md')).exists()).toBe(false);
      process.exitCode = 0;
      await runNew(dir, '.');
      expect(process.exitCode).toBe(1);
    });
  });

  it('infiere el título conservando acentos y ñ (sin warning falso)', async () => {
    await withTempDir(async (dir) => {
      process.exitCode = 0;
      const stderrSpy = spyStderr();
      let output = '';
      try {
        await runNew(dir, 'mi-artículo');
      } finally {
        output = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
        stderrSpy.mockRestore();
      }
      expect(process.exitCode).toBe(0);
      const content = await Bun.file(join(dir, 'mi-artículo.md')).text();
      expect(content).toContain('title: "Mi Artículo"');
      expect(output).not.toContain('⚠');
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

describe('runBuild (smoke PDF real)', () => {
  afterEach(resetExitCode);

  it.skipIf(!latexOk || !pandocOk)(
    'genera un PDF válido de extremo a extremo (con TOC: guardia del hook tocbasic)',
    async () => {
      await withTempDir(async (dir) => {
        await initTestProject(dir);
        // toc: true ejercita el hook \tocbasic@listhead@toc de 17-toc-section
        await writeFile(join(dir, 'iteraciones.config.yaml'), 'language: es-MX\ntoc: true\nformat:\n  pdf:\n    generate: true\n', 'utf8');
        process.exitCode = 0;
        await runBuild(dir);
        expect(process.exitCode).toBe(0);
        const pdfPath = join(dir, 'dist', 'files', 'test-document.pdf');
        expect(await Bun.file(pdfPath).exists()).toBe(true);
        const head = (await Bun.file(pdfPath).arrayBuffer()).slice(0, 4);
        expect(new TextDecoder().decode(head)).toBe('%PDF');
      });
    },
    { timeout: 120_000 },
  );

  it.skipIf(!latexOk || !pandocOk)(
    '99-pdfx activo produce un PDF/X-1a real con /TrimBox (regresión: \\pdfpagesattr{} lo vaciaba)',
    async () => {
      await withTempDir(async (dir) => {
        await initTestProject(dir);
        // 99-pdfx activo: se quita de la disabled list por defecto (97 y 98 siguen desactivados)
        await writeFile(
          join(dir, 'iteraciones.config.yaml'),
          'language: es-MX\nformat:\n  pdf:\n    generate: true\n    disabled-preamble-filters:\n      - 97-eso-pic\n      - 98-crop\n',
          'utf8',
        );
        process.exitCode = 0;
        const stdoutSpy = spyOn(process.stdout, 'write');
        let buildOutput = '';
        try {
          await runBuild(dir);
          buildOutput = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
        } finally {
          stdoutSpy.mockRestore();
        }
        expect(process.exitCode).toBe(0);
        const pdfPath = join(dir, 'dist', 'files', 'test-document.pdf');
        const pdf = await Bun.file(pdfPath).text();
        // pdfx escribe los boxes en el catálogo: /TrimBox es obligatorio en PDF/X-1a
        expect(pdf).toContain('/TrimBox');
        // Validación real con pdf-oxide (issue #1953): solo cuando el binario
        // está disponible (la suite no compila Rust; el binario se resuelve de
        // la caché de usuario o PATH).
        const binary = await resolvePdfCheckBinary();
        if (binary) {
          const check = await validatePdfX1a(pdfPath, binary);
          // Estricto PDF/X-1a:2001 (issues #1964/#1967): el pipeline emite la
          // identificación x-1a1 + pdfxid:GTS_PDFXVersion → el PDF certifica.
          expect(check.valid).toBe(true);
          // Confirmación positiva en el resumen final (issue #1960)
          expect(buildOutput).toContain('Validación PDF/X-1a: 1 PDF certifica PDF/X-1a');
        }
      });
    },
    { timeout: 120_000 },
  );

  it.skipIf(!latexOk || !pandocOk)(
    '97-eso-pic activo compila sin option clash con 30-endpapers (grid en runtime)',
    async () => {
      await withTempDir(async (dir) => {
        await initTestProject(dir);
        // 97-eso-pic activo (grid): solo se quita de la disabled list por defecto.
        // 30-endpapers sigue cargando \usepackage{eso-pic} plano: antes esto
        // fallaba con "! LaTeX Error: Option clash for package eso-pic." (#1962).
        await writeFile(
          join(dir, 'iteraciones.config.yaml'),
          'language: es-MX\nformat:\n  pdf:\n    generate: true\n    disabled-preamble-filters:\n      - 98-crop\n      - 99-pdfx\n',
          'utf8',
        );
        process.exitCode = 0;
        await runBuild(dir);
        expect(process.exitCode).toBe(0);
        expect(await Bun.file(join(dir, 'dist', 'files', 'test-document.pdf')).exists()).toBe(true);
      });
    },
    { timeout: 120_000 },
  );

  it.skipIf(!latexOk || !pandocOk)(
    'cover-image: true genera la portada PNG junto a cada PDF',
    async () => {
      await withTempDir(async (dir) => {
        await initTestProject(dir);
        await writeFile(
          join(dir, 'iteraciones.config.yaml'),
          'language: es-MX\nformat:\n  pdf:\n    generate: true\n    cover-image: true\n',
          'utf8',
        );
        process.exitCode = 0;
        await runBuild(dir);
        expect(process.exitCode).toBe(0);
        const pngPath = join(dir, 'dist', 'files', 'test-document.png');
        expect(await Bun.file(pngPath).exists()).toBe(true);
        // Firma PNG: bytes 1-3 son "PNG" (el byte 0 es 0x89)
        const bytes = new Uint8Array(await Bun.file(pngPath).arrayBuffer());
        expect(new TextDecoder().decode(bytes.subarray(1, 4))).toBe('PNG');
      });
    },
    { timeout: 120_000 },
  );

  it.skipIf(!latexOk || !pandocOk)(
    'desactivar cover-image elimina las portadas PNG huérfanas',
    async () => {
      await withTempDir(async (dir) => {
        await initTestProject(dir);
        const coverConfig = 'language: es-MX\nformat:\n  pdf:\n    generate: true\n    cover-image: true\n';
        await writeFile(join(dir, 'iteraciones.config.yaml'), coverConfig, 'utf8');
        process.exitCode = 0;
        await runBuild(dir);
        const pngPath = join(dir, 'dist', 'files', 'test-document.png');
        expect(await Bun.file(pngPath).exists()).toBe(true);
        // Desactivar la portada: el hash del formato PDF cambia, re-renderiza y el
        // barrido del orquestador elimina los PNG huérfanos del build anterior.
        await writeFile(join(dir, 'iteraciones.config.yaml'), 'language: es-MX\nformat:\n  pdf:\n    generate: true\n', 'utf8');
        process.exitCode = 0;
        await runBuild(dir);
        expect(process.exitCode).toBe(0);
        expect(await Bun.file(pngPath).exists()).toBe(false);
      });
    },
    { timeout: 180_000 },
  );
});

describe('logger (color hermético en tests)', () => {
  it('no emite códigos ANSI aunque el stream sea un TTY', () => {
    const original = Object.getOwnPropertyDescriptor(process.stderr, 'isTTY');
    Object.defineProperty(process.stderr, 'isTTY', { value: true, configurable: true });
    const stderrSpy = spyStderr();
    let output = '';
    try {
      logWarning('mensaje de prueba', 'test');
    } finally {
      output = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
      stderrSpy.mockRestore();
      if (original) Object.defineProperty(process.stderr, 'isTTY', original);
      else delete (process.stderr as { isTTY?: boolean }).isTTY;
    }
    expect(output).toContain('⚠ [test] mensaje de prueba');
    expect(output).not.toContain('\x1b');
  });
});

describe('wiring parser → dispatcher (argv reales)', () => {
  afterEach(resetExitCode);

  it('init vía parseAsync crea los tres archivos', async () => {
    await withTempDir(async (dir) => {
      process.exitCode = 0;
      await buildProgram().parseAsync(['bun', 'bin.ts', 'init', '--project-root', dir]);
      expect(process.exitCode).toBe(0);
      expect(await Bun.file(join(dir, 'iteraciones.config.yaml')).exists()).toBe(true);
      expect(await Bun.file(join(dir, 'index.md')).exists()).toBe(true);
      expect(await Bun.file(join(dir, 'bibliography.bib')).exists()).toBe(true);
    });
  });

  it('new vía parseAsync crea el documento con el título pasado', async () => {
    await withTempDir(async (dir) => {
      process.exitCode = 0;
      await buildProgram().parseAsync(['bun', 'bin.ts', 'new', '--title', 'Título CLI', 'posts/articulo', '--project-root', dir]);
      expect(process.exitCode).toBe(0);
      const content = await Bun.file(join(dir, 'posts', 'articulo.md')).text();
      expect(content).toContain('title: "Título CLI"');
    });
  });

  it('clean vía parseAsync elimina dist/ y .iteraciones/', async () => {
    await withTempDir(async (dir) => {
      await mkdir(join(dir, 'dist', 'files'), { recursive: true });
      await mkdir(join(dir, '.iteraciones'), { recursive: true });
      await writeFile(join(dir, 'dist', 'files', 'x.html'), 'x', 'utf8');
      process.exitCode = 0;
      await buildProgram().parseAsync(['bun', 'bin.ts', 'clean', '--project-root', dir]);
      expect(process.exitCode).toBe(0);
      expect(await Bun.file(join(dir, 'dist')).exists()).toBe(false);
      expect(await Bun.file(join(dir, '.iteraciones')).exists()).toBe(false);
    });
  });

  it('list-filters vía parseAsync termina con exit 0 y lista los filters', async () => {
    await withTempDir(async (dir) => {
      const stdoutSpy = spyOn(process.stdout, 'write');
      let out = '';
      try {
        process.exitCode = 0;
        await buildProgram().parseAsync(['bun', 'bin.ts', 'list-filters', '--project-root', dir]);
      } finally {
        out = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
        stdoutSpy.mockRestore();
      }
      expect(process.exitCode).toBe(0);
      expect(out).toContain('latex/02-dictum');
    });
  });

  it('--version sale con exit code 0', async () => {
    process.exitCode = 0;
    let exitCode = 0;
    try {
      await buildProgram().parseAsync(['bun', 'bin.ts', '--version']);
    } catch (err) {
      exitCode = err instanceof CommanderError ? err.exitCode : 1;
    }
    expect(exitCode).toBe(0);
  });

  it('--project-root en uso positivo: build con root explícito genera la salida', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      process.exitCode = 0;
      await buildProgram().parseAsync(['bun', 'bin.ts', 'build', '--project-root', dir]);
      expect(process.exitCode).toBe(0);
      expect(await Bun.file(join(dir, 'dist', 'files', 'test-document.html')).exists()).toBe(true);
    });
  });

  it('--output . (la raíz del proyecto) se rechaza', async () => {
    await withTempDir(async (dir) => {
      const stderrSpy = spyStderr();
      let output = '';
      try {
        process.exitCode = 0;
        await buildProgram().parseAsync(['bun', 'bin.ts', 'build', '--output', '.', '--project-root', dir]);
      } finally {
        output = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
        stderrSpy.mockRestore();
      }
      expect(process.exitCode).toBe(1);
      expect(output).toContain('--output');
    });
  });

  it('--full reporta la eliminación de caché y salida (verbose)', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      const stdoutSpy = spyOn(process.stdout, 'write');
      let out = '';
      try {
        process.exitCode = 0;
        await runBuild(dir, { full: true, verbose: true });
      } finally {
        out = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
        stdoutSpy.mockRestore();
      }
      expect(process.exitCode).toBe(0);
      expect(out).toContain('--full: se eliminaron la caché y la salida anterior');
    });
  });

  it('--full con build fallido limpia la salida parcial de dist/', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await mkdir(join(dir, 'dist', 'files'), { recursive: true });
      await writeFile(join(dir, 'dist', 'files', 'parcial.html'), 'basura', 'utf8');
      await writeFile(join(dir, 'test.md'), '---\ntitle: [roto\n---\n\nCuerpo.\n', 'utf8');
      process.exitCode = 0;
      await runBuild(dir, { full: true });
      expect(process.exitCode).toBe(1);
      expect(await Bun.file(join(dir, 'dist', 'files')).exists()).toBe(false);
    });
  });

  it('clean con fallo (EACCES) reporta el directorio y sale con código 1', async () => {
    await withTempDir(async (dir) => {
      await mkdir(join(dir, 'dist', 'bloqueado'), { recursive: true });
      await writeFile(join(dir, 'dist', 'bloqueado', 'x.txt'), 'x', 'utf8');
      await Bun.$`chmod 000 ${join(dir, 'dist', 'bloqueado')}`;
      const stderrSpy = spyStderr();
      let output = '';
      try {
        process.exitCode = 0;
        await runClean(dir);
      } finally {
        output = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
        stderrSpy.mockRestore();
        await Bun.$`chmod 700 ${join(dir, 'dist', 'bloqueado')}`;
      }
      expect(process.exitCode).toBe(1);
      expect(output).toContain('no se pudo eliminar');
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

describe('doctor condicionado al proyecto (#2082)', () => {
  afterEach(resetExitCode);

  /** Ejecuta doctor y captura stdout (mismo patrón del describe runDoctor). */
  async function doctorOut(dir: string): Promise<string> {
    const spy = spyOn(process.stdout, 'write');
    let output = '';
    try {
      process.exitCode = 0;
      await runDoctor(dir);
    } finally {
      output = spy.mock.calls.map((c) => String(c[0])).join('');
      spy.mockRestore();
    }
    return output;
  }

  it.skipIf(!pandocOk)('un proyecto HTML-only no lista pdfcheck ni ImageMagick', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir); // html-only
      const output = await doctorOut(dir);
      expect(output).not.toContain('iteraciones-pdfcheck');
      expect(output).not.toContain('ImageMagick');
    });
  });

  it('PDF sin 99-pdfx activo (defaults) no lista el check de certificación', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(join(dir, 'iteraciones.config.yaml'), 'language: es-MX\nformat:\n  pdf:\n    generate: true\n', 'utf8');
      const output = await doctorOut(dir);
      expect(output).toContain('pdflatex');
      expect(output).not.toContain('iteraciones-pdfcheck');
    });
  });

  it('PDF con 99-pdfx activo (disabled-preamble-filters: []) lista el check de certificación', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(
        join(dir, 'iteraciones.config.yaml'),
        'language: es-MX\nformat:\n  pdf:\n    generate: true\n    disabled-preamble-filters: []\n',
        'utf8',
      );
      const output = await doctorOut(dir);
      expect(output).toContain('iteraciones-pdfcheck');
    });
  });
});

describe('reportBuildError: sugerencias por código estructural (#2082)', () => {
  afterEach(resetExitCode);

  function stderrOf(fn: () => void): string {
    const spy = spyOn(process.stderr, 'write');
    let output = '';
    try {
      fn();
    } finally {
      output = spy.mock.calls.map((c) => String(c[0])).join('');
      spy.mockRestore();
    }
    return output;
  }

  it('PandocError env-missing sugiere doctor', () => {
    const out = stderrOf(() =>
      reportBuildError(
        new PandocError('latexmk no está disponible en PATH. Instala MacTeX full: https://tug.org/mactex/', '', '', PANDOC_ERROR_CODES.envMissing),
      ),
    );
    expect(out).toContain("ejecuta 'iteraciones doctor'");
    expect(out).not.toContain("'iteraciones validate'");
  });

  it('ProcessSpawnError sugiere doctor', () => {
    const out = stderrOf(() => reportBuildError(new ProcessSpawnError('No se encontró el comando "magick".')));
    expect(out).toContain("ejecuta 'iteraciones doctor'");
  });

  it('errores que no son de entorno no sugieren doctor', () => {
    const out = stderrOf(() => reportBuildError(new Error('algo raro')));
    expect(out).not.toContain('iteraciones doctor');
  });
});
