import { describe, expect, it, spyOn } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { discover } from '../builder/discover.js';
import { postProcessCollections } from '../builder/orchestrator.js';
import { readCollectionEntries } from '../builder/pipeline-formats.js';
import { loadStateFile, stateUsableForBuild } from '../builder/state-serialize.js';
import { runBuild } from '../cli/dispatcher.js';
import { runMerge } from '../cli/merge.js';
import { validateProject } from '../cli/validate.js';
import { BuildError } from '../lib/errors.js';
import { getPandocVersion } from '../lib/pandoc-runner.js';
import { registerSkip, SKIP_REASONS, withTempDir } from './helpers.js';

/**
 * #2443: resolución de files[] de collections.
 * - relativo al .md de la collection primero (`../` y anidamiento válidos),
 *   con fallback a la raíz del proyecto (convención previa, fixtures);
 * - inexistente → error listando las rutas intentadas, en build y en validate;
 * - `iteraciones merge` acepta files relativos a la raíz desde un subdir.
 *
 * Solo el build requiere pandoc; sin él, ese test queda skipado (decisión D3).
 */
const pandocOk = await getPandocVersion().catch(() => null);
if (!pandocOk) registerSkip('collection-files-paths.test.ts', SKIP_REASONS.pandoc);

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

async function writeMd(path: string, lines: string[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, `${lines.join('\n')}\n`);
}

async function discoverIndex(dir: string) {
  const result = await discover(dir, { prevState: stateUsableForBuild(await loadStateFile(dir)) });
  return result.discoveryIndex;
}

describe('files[] de collections relativos a la collection (#2443)', () => {
  it('postProcess normaliza a relativo-de-raíz vía collection-dir, con fallback a la raíz', async () => {
    await withTempDir(async (dir) => {
      await writeMd(join(dir, 'raiz.md'), ['---', 'title: Raíz', '---', '', 'En la raíz.']);
      await writeMd(join(dir, 'sub', 'miembro-local.md'), ['---', 'title: Local', '---', '', 'Local.']);
      await writeMd(join(dir, 'sub', 'miembro2.md'), ['---', 'title: Miembro 2', '---', '', 'Root-style.']);
      await writeMd(join(dir, 'sub', 'coleccion.md'), ['---', 'type: collection', 'files:', '  - ../raiz.md', '  - miembro-local.md', '---']);
      await writeMd(join(dir, 'sub', 'c2.md'), ['---', 'type: collection', 'files:', '  - sub/miembro2.md', '---']);

      const index = await discoverIndex(dir);
      await postProcessCollections(index, dir);

      expect(index.get('sub/coleccion.md')?.files).toEqual(['raiz.md', 'sub/miembro-local.md']);
      expect(index.get('sub/coleccion.md')?.fm?.files).toEqual(['raiz.md', 'sub/miembro-local.md']);
      expect(index.get('sub/c2.md')?.files).toEqual(['sub/miembro2.md']);
    });
  });

  it('archivo inexistente: postProcess lo deja como está y la lectura falla con las rutas intentadas', async () => {
    await withTempDir(async (dir) => {
      await writeMd(join(dir, 'test', 'collection.md'), ['---', 'type: collection', 'files:', '  - ../02-prologo.md', '---']);

      // postProcess es tolerante (spec de collection-creators.test): no normaliza
      // lo irresoluble y no lanza.
      const index = await discoverIndex(dir);
      await postProcessCollections(index, dir);
      expect(index.get('test/collection.md')?.files).toEqual(['../02-prologo.md']);
      expect(index.get('test/collection.md')?.fm?.files).toEqual(['../02-prologo.md']);

      // el build falla al leer, listando las rutas intentadas (raíz y dir de la collection)
      const err = await readCollectionEntries(['../02-prologo.md'], 'test/collection.md', [dir, join(dir, 'test')]).then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(BuildError);
      const message = (err as Error).message;
      expect(message).toContain('collection "test/collection.md"');
      expect(message).toContain('"../02-prologo.md"');
      expect(message).toContain('probado');
      expect(message).toContain(join(dir, '02-prologo.md')); // relativo a la collection
      expect(message).toContain(join(dir, '..', '02-prologo.md')); // relativo a la raíz
    });
  });

  it('validate lista los files inexistentes con las rutas intentadas', async () => {
    await withTempDir(async (dir) => {
      await writeMd(join(dir, 'iteraciones.config.yaml'), [CONFIG]);
      await writeMd(join(dir, 'doc.md'), ['---', 'title: Doc', '---', '', 'Contenido.']);
      await writeMd(join(dir, 'test', 'collection.md'), ['---', 'type: collection', 'files:', '  - ../02-prologo.md', '---']);

      const spy = spyOn(process.stderr, 'write');
      let output = '';
      try {
        process.exitCode = 0;
        await validateProject(dir);
        output = spy.mock.calls.map((c) => String(c[0])).join('');
      } finally {
        spy.mockRestore();
      }
      expect(process.exitCode, 'validate debe fallar con el file inexistente').toBe(1);
      expect(output).toContain('files: no encontrado "../02-prologo.md"');
      expect(output).toContain('probado');
      expect(output).toContain(join(dir, '02-prologo.md'));

      // creado el archivo (relativo a la collection), validate pasa
      await writeMd(join(dir, '02-prologo.md'), ['---', 'title: Prólogo', '---', '', 'Prólogo.']);
      process.exitCode = 0;
      await validateProject(dir);
      expect(process.exitCode, 'validate debe pasar cuando el file existe').toBe(0);
      process.exitCode = 0;
    });
  });

  it('iteraciones merge resuelve files relativos a la raíz desde un subdir', async () => {
    await withTempDir(async (dir) => {
      await writeMd(join(dir, 'iteraciones.config.yaml'), [CONFIG]);
      await writeMd(join(dir, 'sub', 'c.md'), ['---', 'title: Antología', 'type: collection', 'files:', '  - sub/m.md', '---', '', 'Intro.']);
      await writeMd(join(dir, 'sub', 'm.md'), ['---', 'title: Miembro', 'creator: Autora X', '---', '', 'Contenido fusionable.']);

      process.exitCode = 0;
      await runMerge(dir, 'sub/c.md', { format: 'markdown', output: 'out.md' });
      expect(process.exitCode, 'merge debe poder leer el miembro vía fallback a la raíz').toBe(0);
      const out = await Bun.file(join(dir, 'out.md')).text();
      expect(out).toContain('## Autora X');
      expect(out).toContain('Contenido fusionable.');
      process.exitCode = 0;
    });
  });

  it.skipIf(!pandocOk)(
    'build: copias, exclusión e idempotencia con rutas anidadas y root-style',
    async () => {
      await withTempDir(async (dir) => {
        await writeMd(join(dir, 'iteraciones.config.yaml'), [CONFIG]);
        await writeMd(join(dir, 'raiz.md'), ['---', 'title: En la raíz', 'creator: Autora A', '---', '', 'Contenido de la raíz.']);
        await writeMd(join(dir, 'sub', 'miembro-local.md'), ['---', 'title: Local', 'creator: Autora C', '---', '', 'Contenido local.']);
        await writeMd(join(dir, 'sub', 'miembro2.md'), ['---', 'title: Miembro 2', 'creator: Autora B', '---', '', 'Contenido 2.']);
        await writeMd(join(dir, 'sub', 'coleccion.md'), [
          '---',
          'title: Colección Anidada',
          'slug: coleccion',
          'type: collection',
          'files:',
          '  - ../raiz.md',
          '  - miembro-local.md',
          '---',
          '',
          'Intro de la colección.',
        ]);
        await writeMd(join(dir, 'sub', 'c2.md'), [
          '---',
          'title: Colección Root-style',
          'slug: c2',
          'type: collection',
          'files:',
          '  - sub/miembro2.md',
          '---',
          '',
          'Intro dos.',
        ]);

        process.exitCode = 0;
        await runBuild(dir);
        expect(process.exitCode, 'build debe pasar').toBe(0);

        const dist = join(dir, 'dist', 'files');
        // copias de los miembros con la ruta espejo de la fuente
        expect(existsSync(join(dist, 'raiz.md'))).toBe(true);
        expect(existsSync(join(dist, 'sub', 'miembro-local.md'))).toBe(true);
        expect(existsSync(join(dist, 'sub', 'miembro2.md'))).toBe(true);
        // los miembros no se construyen como standalone
        expect(existsSync(join(dist, 'raiz.html'))).toBe(false);
        expect(existsSync(join(dist, 'sub', 'miembro-local.html'))).toBe(false);
        expect(existsSync(join(dist, 'sub', 'miembro2.html'))).toBe(false);
        // las collections sí
        expect(existsSync(join(dist, 'sub', 'coleccion.html'))).toBe(true);
        expect(existsSync(join(dist, 'sub', 'c2.html'))).toBe(true);

        // files[] reescrito relativo al .md de dist con ambos estilos de origen
        const coleccionMd = await Bun.file(join(dist, 'sub', 'coleccion.md')).text();
        expect(coleccionMd).toContain('type: collection');
        expect(coleccionMd).toContain('../raiz.md');
        expect(coleccionMd).toContain('miembro-local.md');
        expect(coleccionMd, 'el origen collection-dir no conserva el prefijo root-style').not.toContain('sub/miembro-local.md');
        expect(coleccionMd).toContain('Intro de la colección.');
        const c2Md = await Bun.file(join(dist, 'sub', 'c2.md')).text();
        expect(c2Md).toContain('miembro2.md');
        expect(c2Md, 'el origen root-style se reescribe relativo al .md de dist').not.toContain('sub/miembro2.md');

        // idempotente: reconstruir sin cambios → mismos bytes
        const antes: Record<string, string> = {};
        for (const rel of ['raiz.md', 'sub/miembro-local.md', 'sub/miembro2.md', 'sub/coleccion.md', 'sub/c2.md', 'sub/coleccion.html']) {
          antes[rel] = await Bun.file(join(dist, rel)).text();
        }
        process.exitCode = 0;
        await runBuild(dir);
        for (const [rel, text] of Object.entries(antes)) {
          expect(await Bun.file(join(dist, rel)).text(), `rebuild debe ser idéntico en ${rel}`).toBe(text);
        }
        expect(existsSync(join(dist, 'raiz.html'))).toBe(false);
        process.exitCode = 0;
      });
    },
    300_000,
  );

  it.skipIf(!pandocOk)(
    'build falla con archivo inexistente en files, listando las rutas intentadas',
    async () => {
      await withTempDir(async (dir) => {
        await writeMd(join(dir, 'iteraciones.config.yaml'), [CONFIG]);
        await writeMd(join(dir, 'test', 'collection.md'), [
          '---',
          'title: Rota',
          'slug: rota',
          'type: collection',
          'files:',
          '  - ../02-prologo.md',
          '---',
        ]);

        const spy = spyOn(process.stderr, 'write');
        let output = '';
        try {
          process.exitCode = 0;
          await runBuild(dir);
          output = spy.mock.calls.map((c) => String(c[0])).join('');
        } finally {
          spy.mockRestore();
        }
        expect(process.exitCode, 'build debe fallar').toBe(1);
        expect(output).toContain('archivo configurado en files no encontrado');
        expect(output).toContain('probado');
        process.exitCode = 0;
      });
    },
    300_000,
  );
});
