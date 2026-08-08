import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CommanderError } from 'commander';
import { runBuild, runClean, runInit, runNew, runValidate } from '../cli/dispatcher.js';
import { buildProgram } from '../cli/parser.js';
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
