import { afterEach, beforeAll, describe, expect, it, spyOn } from 'bun:test';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { runBuild } from '../cli/dispatcher.js';
import { buildProgram } from '../cli/parser.js';
import { setLoggerColorEnabled } from '../lib/logger.js';
import { getPandocVersion } from '../lib/pandoc-runner.js';
import { registerSkip, SKIP_REASONS, withTempDir } from './helpers.js';

/**
 * #2453 — `iteraciones build [paths...]`.
 *
 * Verificación del issue:
 * - lo que sale de `build <path>` es byte-idéntico a esos mismos ficheros
 *   dentro de un build completo;
 * - `dist` de los documentos no seleccionados queda intacto;
 * - la colección expande `files[]` + creators y un miembro se queda solo en él;
 * - dos `build <path>` seguidos dejan el mismo resultado;
 * - `--full <path>`, path inexistente y path fuera del proyecto → exit 1.
 *
 * Solo el build requiere pandoc; sin él, los bloques quedan skipados (D3).
 */
const pandocOk = await getPandocVersion().catch(() => null);
if (!pandocOk) registerSkip('build-selection.test.ts', SKIP_REASONS.pandoc);

beforeAll(() => setLoggerColorEnabled(false));

const CONFIG = [
  'language: es-MX',
  'format:',
  '  html:',
  '    site:',
  '      title: T',
  '    generate: true',
  '  markdown:',
  '    generate: true',
].join('\n');

/**
 * Proyecto con collection (`index.md` → cap1 + miembro + creator Ana), un
 * documento suelto y un miembro dentro de un subdirectorio.
 */
async function writeProject(dir: string, opts: { collectionInFiles?: boolean } = {}): Promise<void> {
  await mkdir(join(dir, 'miembros'), { recursive: true });
  if (opts.collectionInFiles) await mkdir(join(dir, 'sub'), { recursive: true });
  await writeFile(join(dir, 'iteraciones.config.yaml'), `${CONFIG}\n`);
  const files = ['cap1.md', 'miembros/mem.md'];
  if (opts.collectionInFiles) files.push('sub/coleccion.md');
  await writeFile(
    join(dir, 'index.md'),
    [
      '---',
      'title: Antología',
      'type: collection',
      'collectionCreator: Ana García',
      'files:',
      ...files.map((f) => `  - ${f}`),
      '---',
      '',
      'Índice.',
    ].join('\n'),
  );
  await writeFile(join(dir, 'cap1.md'), '---\ntitle: Capítulo Uno\ncreator: Ana García\n---\n\nContenido.\n');
  await writeFile(join(dir, 'miembros', 'mem.md'), '---\ntitle: Miembro\ncreator: Bruno Díaz\n---\n\nMiembro.\n');
  await writeFile(join(dir, 'ana.md'), '---\ntype: creator\nname: Ana García\n---\n\nEscritora.\n');
  await writeFile(join(dir, 'suelto.md'), '---\ntitle: Suelto\ncreator: Bruno Díaz\n---\n\nSuelto.\n');
  if (opts.collectionInFiles) await writeFile(join(dir, 'sub', 'coleccion.md'), '---\ntype: collection\nfiles:\n  - ../suelto.md\n---\n');
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === '.DS_Store') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(path)));
    else out.push(path);
  }
  return out.sort();
}

/** path relativo → sha256 de `dist/files`, para comparar antes/después. */
async function snapshot(root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const abs of await walk(join(root, 'dist', 'files'))) {
    out[relative(root, abs)] = new Bun.CryptoHasher('sha256').update(await Bun.file(abs).arrayBuffer()).digest('hex');
  }
  return out;
}

/** Salidas de documentos (html y markdown), sin assets. */
function documentales(snapshot: Record<string, string>): string[] {
  return Object.keys(snapshot)
    .filter((p) => p.endsWith('.html') || p.endsWith('.md'))
    .sort();
}

function resetExitCode(): void {
  process.exitCode = 0;
}

async function runExpectandoError(fn: () => Promise<void>): Promise<string> {
  const spy = spyOn(process.stderr, 'write');
  let output = '';
  try {
    process.exitCode = 0;
    await fn();
  } finally {
    output = spy.mock.calls.map((c) => String(c[0])).join('');
    spy.mockRestore();
  }
  return output;
}

describe('build [paths...] — selección (#2453)', () => {
  afterEach(resetExitCode);

  it('lo que sale de build <path> es byte-idéntico a esos ficheros en un build completo', async () => {
    await withTempDir(async (dir) => {
      const completo = join(dir, 'completo');
      const parcial = join(dir, 'parcial');
      await writeProject(completo);
      await writeProject(parcial);

      process.exitCode = 0;
      await runBuild(completo);
      expect(process.exitCode).toBe(0);

      process.exitCode = 0;
      await runBuild(parcial, { only: ['cap1.md'] });
      expect(process.exitCode).toBe(0);

      const a = await snapshot(completo);
      const b = await snapshot(parcial);
      expect(documentales(b)).toEqual(['dist/files/capitulo-uno-por-ana-garcia.html', 'dist/files/capitulo-uno-por-ana-garcia.md']);
      for (const path of documentales(b)) expect(b[path]).toBe(a[path]);
    });
  });

  it('el dist de los documentos no seleccionados queda intacto', async () => {
    await withTempDir(async (dir) => {
      await writeProject(dir);
      process.exitCode = 0;
      await runBuild(dir);
      const antes = await snapshot(dir);

      // El seleccionado (suelto) cambia; cap1.md también, pero NO está en la
      // selección: sus salidas tienen que seguir con el contenido de antes.
      await writeFile(join(dir, 'cap1.md'), '---\ntitle: Capítulo Uno\ncreator: Ana García\n---\n\nContenido NUEVO.\n');
      process.exitCode = 0;
      await runBuild(dir, { only: ['suelto.md'] });
      expect(process.exitCode).toBe(0);

      expect(await snapshot(dir)).toEqual(antes);
    });
  });

  it('una collection expande sus files[] y sus creators', async () => {
    await withTempDir(async (dir) => {
      await writeProject(dir);
      process.exitCode = 0;
      await runBuild(dir, { only: ['index.md'] });
      expect(process.exitCode).toBe(0);

      expect(documentales(await snapshot(dir))).toEqual([
        'dist/files/ana-garcia.html', // creator de los miembros
        'dist/files/ana-garcia.md',
        'dist/files/capitulo-uno-por-ana-garcia.html',
        'dist/files/capitulo-uno-por-ana-garcia.md',
        'dist/files/index.html',
        'dist/files/index.md',
        'dist/files/miembros/miembro-por-bruno-diaz.html',
        'dist/files/miembros/miembro-por-bruno-diaz.md',
      ]);
    });
  });

  it('un miembro de files[] se queda solo en él (nunca sube a la colección)', async () => {
    await withTempDir(async (dir) => {
      await writeProject(dir);
      process.exitCode = 0;
      await runBuild(dir, { only: ['miembros/mem.md'] });
      expect(process.exitCode).toBe(0);

      expect(documentales(await snapshot(dir))).toEqual([
        'dist/files/miembros/miembro-por-bruno-diaz.html',
        'dist/files/miembros/miembro-por-bruno-diaz.md',
      ]);
    });
  });

  it('dos build <path> seguidos dejan exactamente el mismo dist', async () => {
    await withTempDir(async (dir) => {
      await writeProject(dir);
      process.exitCode = 0;
      await runBuild(dir, { only: ['index.md'] });
      expect(process.exitCode).toBe(0);
      const primero = await snapshot(dir);

      process.exitCode = 0;
      await runBuild(dir, { only: ['index.md'] });
      expect(process.exitCode).toBe(0);

      expect(await snapshot(dir)).toEqual(primero);
    });
  });

  it('acepta varios paths en la misma corrida', async () => {
    await withTempDir(async (dir) => {
      await writeProject(dir);
      process.exitCode = 0;
      await runBuild(dir, { only: ['cap1.md', './suelto.md', 'miembros/../cap1.md'] });
      expect(process.exitCode).toBe(0);

      expect(documentales(await snapshot(dir))).toEqual([
        'dist/files/capitulo-uno-por-ana-garcia.html',
        'dist/files/capitulo-uno-por-ana-garcia.md',
        'dist/files/suelto-por-bruno-diaz.html',
        'dist/files/suelto-por-bruno-diaz.md',
      ]);
    });
  });
});

describe('build [paths...] — errores y superficie (#2453)', () => {
  afterEach(resetExitCode);

  it('--full con paths es error, no una variante', async () => {
    await withTempDir(async (dir) => {
      await writeProject(dir);
      const output = await runExpectandoError(() => runBuild(dir, { full: true, only: ['cap1.md'] }));
      expect(process.exitCode).toBe(1);
      expect(output).toContain('incompatibles');
      expect(output).toContain('--full borra la salida');
    });
  });

  it('path inexistente: exit 1 con el candidato cuando lo hay', async () => {
    await withTempDir(async (dir) => {
      await writeProject(dir);
      const output = await runExpectandoError(() => runBuild(dir, { only: ['mem.md'] }));
      expect(process.exitCode).toBe(1);
      expect(output).toContain('no existe el documento "mem.md"');
      expect(output).toContain('miembros/mem.md');
    });
  });

  it('path fuera del proyecto: exit 1 sin salirse de la raíz', async () => {
    await withTempDir(async (dir) => {
      await writeProject(dir);
      const output = await runExpectandoError(() => runBuild(dir, { only: ['../fuera.md'] }));
      expect(process.exitCode).toBe(1);
      expect(output).toContain('está fuera del proyecto');
    });
  });

  it('una collection dentro de files[] de otra es error de build', async () => {
    await withTempDir(async (dir) => {
      await writeProject(dir, { collectionInFiles: true });
      const output = await runExpectandoError(() => runBuild(dir));
      expect(process.exitCode).toBe(1);
      expect(output).toContain('una collection no puede formar parte de otra');
      expect(output).toContain('Quítalo de files[]');
    });
  });

  it('el error de la selección no deja dist a medias', async () => {
    await withTempDir(async (dir) => {
      await writeProject(dir);
      process.exitCode = 0;
      await runBuild(dir);
      const antes = await snapshot(dir);

      await runExpectandoError(() => runBuild(dir, { only: ['no-existe.md'] }));
      expect(process.exitCode).toBe(1);
      expect(await snapshot(dir)).toEqual(antes);
    });
  });

  it('la CLI admite paths posicionales y también el build entero sin ellos', async () => {
    await withTempDir(async (dir) => {
      await writeProject(dir);
      process.exitCode = 0;
      await buildProgram().parseAsync(['bun', 'bin.ts', 'build', 'cap1.md', '--project-root', dir]);
      expect(process.exitCode).toBe(0);
      expect(documentales(await snapshot(dir))).toEqual(['dist/files/capitulo-uno-por-ana-garcia.html', 'dist/files/capitulo-uno-por-ana-garcia.md']);

      process.exitCode = 0;
      await buildProgram().parseAsync(['bun', 'bin.ts', 'build', '--project-root', dir]);
      expect(process.exitCode).toBe(0);
      expect(documentales(await snapshot(dir))).toContain('dist/files/index.html');
    });
  });
});
