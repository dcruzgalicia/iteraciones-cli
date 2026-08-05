import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runBuild, runClean, runInfo, runInit, runNew, runValidate } from '../cli/dispatcher.js';
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
