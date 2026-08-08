import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CommanderError } from 'commander';
import { runBuild, runClean, runDoctor, runInfo, runInit, runNew, runValidate } from '../cli/dispatcher.js';
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
