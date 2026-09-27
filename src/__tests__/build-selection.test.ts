import { afterEach, beforeAll, describe, expect, it, spyOn } from 'bun:test';
import { chmod, mkdir, readdir, writeFile } from 'node:fs/promises';
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
 * #2454 — aislamiento del modo parcial: `state.json`, `build.sh`, la limpieza
 * de slugs cambiados y la validación PDF/X no se mueven fuera de la selección.
 *
 * #2455 — superficie de `--json`: seis claves congeladas (D6) y `selected`
 * solo en una corrida con selección.
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
async function writeProject(dir: string, opts: { collectionInFiles?: boolean; script?: boolean } = {}): Promise<void> {
  await mkdir(join(dir, 'miembros'), { recursive: true });
  if (opts.collectionInFiles) await mkdir(join(dir, 'sub'), { recursive: true });
  await writeFile(join(dir, 'iteraciones.config.yaml'), opts.script === true ? `${CONFIG}\nscript: true\n` : `${CONFIG}\n`);
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

/**
 * #2455 — corre `runBuild` con `--json` y devuelve el único objeto que puede
 * salir por stdout (la salida humana queda suprimida: D6).
 */
async function jsonDeBuild(dir: string, options: { only?: string[] } = {}): Promise<Record<string, unknown>> {
  const spy = spyOn(process.stdout, 'write');
  let raw = '';
  try {
    process.exitCode = 0;
    await runBuild(dir, { ...options, json: true });
    expect(process.exitCode).toBe(0);
  } finally {
    raw = spy.mock.calls.map((c) => String(c[0])).join('');
    spy.mockRestore();
  }
  const lines = raw
    .trim()
    .split('\n')
    .filter((line) => line.trim() !== '');
  expect(lines.length).toBe(1);
  return JSON.parse(lines[0] ?? '') as Record<string, unknown>;
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

/** Contenido de un fichero de texto, o `<no existe>` cuando no está. */
async function text(path: string): Promise<string> {
  const file = Bun.file(path);
  return (await file.exists()) ? await file.text() : '<no existe>';
}

/**
 * #2454 — aislamiento del modo parcial: state, build.sh, limpiezas y la
 * validación PDF/X no pueden mover nada que sea del proyecto entero.
 *
 * Verificación del issue:
 * - `state.json` y `build.sh` byte a byte iguales tras un build parcial;
 * - varios parciales seguidos y después un completo ≡ proyecto intocado;
 * - un PDF roto ajeno no tumba la corrida de otro documento;
 * - la limpieza de slugs cambiados queda acotada a la selección.
 */
describe('build parcial — aislamiento del modo parcial (#2454)', () => {
  const STATE = join('.iteraciones', 'state.json');
  afterEach(resetExitCode);

  it('state.json y build.sh quedan byte a byte iguales tras un build parcial', async () => {
    await withTempDir(async (dir) => {
      await writeProject(dir, { script: true });
      process.exitCode = 0;
      await runBuild(dir);
      expect(process.exitCode).toBe(0);

      const state = await text(join(dir, STATE));
      const script = await text(join(dir, 'build.sh'));
      expect(state).not.toBe('<no existe>');
      expect(script).not.toBe('<no existe>');

      process.exitCode = 0;
      await runBuild(dir, { only: ['suelto.md'] });
      expect(process.exitCode).toBe(0);
      expect(await text(join(dir, STATE))).toBe(state);
      expect(await text(join(dir, 'build.sh'))).toBe(script);

      // Otro parcial, otro documento: sigue sin moverse.
      process.exitCode = 0;
      await runBuild(dir, { only: ['cap1.md'] });
      expect(process.exitCode).toBe(0);
      expect(await text(join(dir, STATE))).toBe(state);
      expect(await text(join(dir, 'build.sh'))).toBe(script);
    });
  });

  it('una edición fuera de la selección no queda «limpia» para el build completo siguiente', async () => {
    await withTempDir(async (dir) => {
      await writeProject(dir);
      process.exitCode = 0;
      await runBuild(dir);
      expect(process.exitCode).toBe(0);

      await writeFile(join(dir, 'cap1.md'), '---\ntitle: Capítulo Uno\ncreator: Ana García\n---\n\nContenido NUEVO.\n');
      process.exitCode = 0;
      await runBuild(dir, { only: ['suelto.md'] });
      expect(process.exitCode).toBe(0);

      // El parcial no persistió su state, así que cap1.md sigue pendiente y
      // el build completo la detecta (sin el arreglo: «todos reutilizados» y
      // dist se queda con el contenido viejo).
      process.exitCode = 0;
      await runBuild(dir);
      expect(process.exitCode).toBe(0);

      const html = await text(join(dir, 'dist', 'files', 'capitulo-uno-por-ana-garcia.html'));
      expect(html).toContain('Contenido NUEVO');
    });
  });

  it('varios parciales seguidos no dejan rastro: el completo da lo mismo que en un proyecto intocado', async () => {
    await withTempDir(async (dir) => {
      const tocado = join(dir, 'tocado');
      const intocado = join(dir, 'intocado');
      await writeProject(tocado);
      await writeProject(intocado);
      process.exitCode = 0;
      await runBuild(tocado);
      process.exitCode = 0;
      await runBuild(intocado);
      expect(process.exitCode).toBe(0);

      const nuevo = '---\ntitle: Capítulo Uno\ncreator: Ana García\n---\n\nContenido NUEVO.\n';
      await writeFile(join(tocado, 'cap1.md'), nuevo);
      await writeFile(join(intocado, 'cap1.md'), nuevo);

      process.exitCode = 0;
      await runBuild(tocado, { only: ['suelto.md'] });
      process.exitCode = 0;
      await runBuild(tocado, { only: ['index.md'] });

      process.exitCode = 0;
      await runBuild(tocado);
      process.exitCode = 0;
      await runBuild(intocado);
      expect(process.exitCode).toBe(0);

      const a = await snapshot(tocado);
      const b = await snapshot(intocado);
      expect(documentales(a)).toEqual(documentales(b));
      for (const path of documentales(a)) expect(a[path]).toBe(b[path]);
    });
  });

  it('la limpieza de un slug cambiado no toca documentos fuera de la selección', async () => {
    await withTempDir(async (dir) => {
      await writeProject(dir);
      process.exitCode = 0;
      await runBuild(dir);
      expect(process.exitCode).toBe(0);

      const salidaVieja = join(dir, 'dist', 'files', 'capitulo-uno-por-ana-garcia.html');
      expect(await Bun.file(salidaVieja).exists()).toBe(true);

      // El título de cap1.md cambia → su slug también, pero el documento no
      // está en la selección: el parcial no debe borrar su salida vieja.
      await writeFile(join(dir, 'cap1.md'), '---\ntitle: Título Nuevo\ncreator: Ana García\n---\n\nContenido.\n');
      process.exitCode = 0;
      await runBuild(dir, { only: ['suelto.md'] });
      expect(process.exitCode).toBe(0);
      expect(await Bun.file(salidaVieja).exists()).toBe(true);

      // El build completo posterior sí hace la limpieza, sin acotar.
      process.exitCode = 0;
      await runBuild(dir);
      expect(process.exitCode).toBe(0);
      expect(await Bun.file(salidaVieja).exists()).toBe(false);
      expect(await Bun.file(join(dir, 'dist', 'files', 'titulo-nuevo-por-ana-garcia.html')).exists()).toBe(true);
    });
  });

  it('un PDF roto ajeno no hace fallar el build parcial (pero sí el completo)', async () => {
    await withTempDir(async (dir) => {
      const xdg = process.env.XDG_CACHE_HOME;
      process.env.XDG_CACHE_HOME = join(dir, 'cache');
      try {
        await writeProject(dir);
        // 99-pdfx activo —sin él la validación se salta entera— pero sin
        // generar PDF: lo que importa aquí es qué MIRA la validación.
        await writeFile(
          join(dir, 'iteraciones.config.yaml'),
          `${CONFIG}\n  pdf:\n    disabledPreambleFilters:\n      - 97-eso-pic\n      - 98-crop\n`,
        );
        process.exitCode = 0;
        await runBuild(dir);
        expect(process.exitCode).toBe(0);

        // Binario falso: certifica todo lo que no se llame «roto».
        const binDir = join(dir, 'cache', 'iteraciones', 'bin');
        await mkdir(binDir, { recursive: true });
        await writeFile(
          join(binDir, 'iteraciones-pdfcheck'),
          [
            '#!/bin/sh',
            'case "$1" in',
            "  *roto*) cat <<'EOF'",
            '{"valid": false, "level": "PDF/X-1a:2001", "errors": [{"code":"MissingTrimBox","message":"falta TrimBox","page":0,"object_id":null,"clause":"6.1.1"}], "warnings": []}',
            'EOF',
            '    ;;',
            "  *) cat <<'EOF'",
            '{"valid": true, "level": "PDF/X-1a:2001", "errors": [], "warnings": []}',
            'EOF',
            '    ;;',
            'esac',
          ].join('\n'),
          'utf8',
        );
        await chmod(join(binDir, 'iteraciones-pdfcheck'), 0o755);

        // Un PDF ajeno, roto, en la salida: no pertenece a nadie de esta corrida.
        await writeFile(join(dir, 'dist', 'files', 'roto.pdf'), '%PDF-1.4 fake', 'utf8');

        process.exitCode = 0;
        await runBuild(dir, { only: ['suelto.md'] });
        expect(process.exitCode).toBe(0);

        // El build completo barre dist entero y ahí sí lo tumba.
        const err = await runExpectandoError(() => runBuild(dir));
        expect(process.exitCode).toBe(1);
        expect(err).toContain('no certifican PDF/X-1a');
        expect(err).toContain('roto.pdf');
      } finally {
        // Restaurar con `= undefined` dejaría el literal "undefined" en el
        // entorno y un build posterior crearía `undefined/` en la raíz.
        if (xdg === undefined) delete process.env.XDG_CACHE_HOME;
        else process.env.XDG_CACHE_HOME = xdg;
      }
    });
  });
});

/**
 * #2455 — superficie de `build --json`: las seis claves congeladas (D6) no
 * cambian de nombre ni desaparecen jamás, y `selected` solo existe cuando la
 * corrida tuvo selección — con el cierre que se construyó, no con lo pedido.
 */
describe('build --json — superficie y contrato (#2455)', () => {
  afterEach(resetExitCode);

  it('añade selected con la selección resuelta y conserva la forma congelada', async () => {
    await withTempDir(async (dir) => {
      await writeProject(dir);

      // Pedimos la colección: lo que devuelve NO es ["index.md"], es el
      // cierre que decidió construir la CLI (files[] + creators).
      const parcial = await jsonDeBuild(dir, { only: ['index.md'] });
      expect(Object.keys(parcial).sort()).toEqual(['cached', 'durationMs', 'formats', 'invalidations', 'outputDir', 'processed', 'selected']);
      expect(parcial.selected).toEqual(['ana.md', 'cap1.md', 'index.md', 'miembros/mem.md']);
      expect(typeof parcial.processed).toBe('number');
      expect(typeof parcial.cached).toBe('number');
      expect(Array.isArray(parcial.formats)).toBe(true);
      expect(typeof parcial.outputDir).toBe('string');
      expect(typeof parcial.durationMs).toBe('number');
      expect(Array.isArray(parcial.invalidations)).toBe(true);

      // Un miembro de files[] pedido por su ruta se queda solo en él.
      const miembro = await jsonDeBuild(dir, { only: ['miembros/mem.md'] });
      expect(miembro.selected).toEqual(['miembros/mem.md']);

      // El build completo no añade nada: seis claves, las de siempre.
      const completo = await jsonDeBuild(dir);
      expect(Object.keys(completo).sort()).toEqual(['cached', 'durationMs', 'formats', 'invalidations', 'outputDir', 'processed']);
      expect('selected' in completo).toBe(false);
    });
  });
});
