import { describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';
import { cp, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { getPandocVersion } from '../lib/pandoc-runner.js';
import { registerSkip, SKIP_REASONS, withTempDir } from './helpers.js';

/**
 * #2437: format.markdown.merge
 * - false (default): dist/<collection>.md conserva type: collection y
 *   files[] (reescritos a dist), mantiene el body original de la collection
 *   y emite las copias de los miembros; re-procesable e idempotente.
 * - true: dist/<collection>.md sale con type: file y el contenido
 *   fusionado, sin copias de miembros.
 * - Las dos salidas son distintas por diseño.
 * - `iteraciones merge` genera el .md fusionado de forma determinista y
 *   rechaza entradas que no son collections.
 *
 * Requiere pandoc; sin él, skip informado (decisión D3).
 */
const pandocOk = await getPandocVersion().catch(() => null);
if (!pandocOk) registerSkip('collection-merge.test.ts', SKIP_REASONS.pandoc);

function config(opts: { merge?: boolean; markdown?: boolean; script?: boolean } = {}): string {
  return [
    'language: es-MX',
    ...(opts.script ? ['script: true'] : []),
    'format:',
    '  html:',
    '    site:',
    '      title: T',
    '    generate: true',
    '  markdown:',
    `    generate: ${opts.markdown !== false}`,
    ...(opts.merge ? ['    merge: true'] : []),
  ].join('\n');
}

const COLECCION = [
  '---',
  'title: Mi colección',
  'type: collection',
  'files:',
  '  - doc.md',
  '  - ./other.md',
  '---',
  '',
  'Intro de la colección.',
  '',
].join('\n');

const DOC = ['---', 'title: Documento', 'creator:', '  - Autora A', '---', '', 'Contenido de doc.', ''].join('\n');
const OTHER = ['---', 'title: Otro', 'creator:', '  - Autora B', '---', '', 'Contenido de other.', ''].join('\n');

describe.skipIf(!pandocOk)('format.markdown.merge y `iteraciones merge` (#2437)', () => {
  it('merge:false re-procesable, merge:true fusionado, y merge CLI determinista', async () => {
    await withTempDir(async (dir) => {
      // === Proyecto con merge:false (default) ===
      const dirFalse = join(dir, 'falso');
      await mkdir(dirFalse, { recursive: true });
      await Bun.write(join(dirFalse, 'iteraciones.config.yaml'), `${config({ script: true })}\n`);
      await Bun.write(join(dirFalse, 'mi-coleccion.md'), COLECCION);
      await Bun.write(join(dirFalse, 'doc.md'), DOC);
      await Bun.write(join(dirFalse, 'other.md'), OTHER);
      const dist = join(dirFalse, 'dist', 'files');

      process.exitCode = 0;
      const { runBuild } = await import('../cli/dispatcher.js');
      await runBuild(dirFalse);

      // -- type: collection + files[] reescritos a dist, sin campos derivados
      const coleccion = await Bun.file(join(dist, 'mi-coleccion.md')).text();
      expect(coleccion).toContain('title: Mi colección');
      expect(coleccion).toContain('type: collection');
      expect(coleccion).toContain('files:');
      expect(coleccion).toContain('doc.md');
      expect(coleccion).toContain('other.md');
      expect(coleccion).not.toContain('creator:');
      expect(coleccion).not.toContain('collectionCreator');
      // -- body original de la collection, NO el fusionado
      expect(coleccion).toContain('Intro de la colección.');
      expect(coleccion).not.toContain('## Autora A');
      expect(coleccion).not.toContain('Autora A');

      // -- copias de los miembros en dist; los miembros no son standalone
      const docCopia = await Bun.file(join(dist, 'doc.md')).text();
      expect(docCopia).toContain('title: Documento');
      expect(docCopia).toContain('Contenido de doc.');
      expect(existsSync(join(dist, 'other.md'))).toBe(true); // './other.md' normalizado
      expect(existsSync(join(dist, 'doc.html'))).toBe(false);
      expect(existsSync(join(dist, 'other.html'))).toBe(false);
      expect(existsSync(join(dist, 'mi-coleccion.html'))).toBe(true);

      // -- idempotente: reconstruir sin cambios → mismos bytes
      await runBuild(dirFalse);
      const despues = await Bun.file(join(dist, 'mi-coleccion.md')).text();
      expect(despues, 'rebuild sin cambios debe ser idéntico').toBe(coleccion);

      // -- re-procesar dist como si fuera origen → mismos bytes
      const dirReproceso = join(dir, 'reproceso');
      await mkdir(dirReproceso, { recursive: true });
      await cp(dist, dirReproceso, { recursive: true });
      await Bun.write(join(dirReproceso, 'iteraciones.config.yaml'), `${config()}\n`);
      await runBuild(dirReproceso);
      for (const name of ['mi-coleccion.md', 'doc.md', 'mi-coleccion.html']) {
        const antes = await Bun.file(join(dist, name)).text();
        const otro = await Bun.file(join(dirReproceso, 'dist', 'files', name)).text();
        expect(otro, `re-proceso de ${name} debe ser idéntico`).toBe(antes);
      }

      // -- un miembro modificado no borra su copia de dist (cleanup #2437)
      await Bun.write(join(dirFalse, 'other.md'), OTHER.replace('Contenido de other.', 'Contenido modificado.'));
      await runBuild(dirFalse);
      expect(existsSync(join(dist, 'other.md')), 'la copia del miembro modificado sobrevive').toBe(true);
      expect(existsSync(join(dist, 'doc.md'))).toBe(true);
      expect(existsSync(join(dist, 'other.html'))).toBe(false);

      // === Proyecto con merge:true (proyecto aparte: salidas distintas por diseño) ===
      const dirTrue = join(dir, 'verdadero');
      await mkdir(dirTrue, { recursive: true });
      await Bun.write(join(dirTrue, 'iteraciones.config.yaml'), `${config({ merge: true })}\n`);
      await Bun.write(join(dirTrue, 'mi-coleccion.md'), COLECCION);
      await Bun.write(join(dirTrue, 'doc.md'), DOC);
      await Bun.write(join(dirTrue, 'other.md'), OTHER);
      await runBuild(dirTrue);
      const distTrue = join(dirTrue, 'dist', 'files');

      const fusionado = await Bun.file(join(distTrue, 'mi-coleccion.md')).text();
      expect(fusionado).toContain('type: file');
      expect(fusionado).not.toContain('files:');
      expect(fusionado).toContain('## Autora A');
      expect(fusionado).toContain('## Autora B');
      expect(fusionado).toContain('Contenido de doc.');
      expect(fusionado).not.toContain('Intro de la colección.');
      expect(fusionado).not.toContain('collectionCreator');
      expect(existsSync(join(distTrue, 'doc.md')), 'merge:true no emite copias de miembros').toBe(false);
      expect(existsSync(join(distTrue, 'other.md'))).toBe(false);
      // Diferentes por diseño: una lleva el body original, la otra el fusionado.
      expect(fusionado).not.toBe(coleccion);

      // === `iteraciones merge` (#2445): la entrada exacta de pandoc ===
      const { runMerge } = await import('../cli/merge.js');

      // rebuild completo: así .iteraciones/collections/ queda con los miembros actuales
      await runBuild(dirFalse, { full: true });

      // -- byte-idéntica a lo que el build ya le dio a pandoc por stdin
      process.exitCode = 0;
      await runMerge(dirFalse, 'mi-coleccion.md', { format: 'html', output: 'salida/coleccion.html.md' });
      expect(process.exitCode, 'merge debe exit 0').toBe(0);
      const generado = await Bun.file(join(dirFalse, 'salida', 'coleccion.html.md')).text();
      const delBuild = await Bun.file(join(dirFalse, '.iteraciones', 'collections', 'mi-coleccion.html.md')).text();
      expect(generado, 'merge debe reproducir byte a byte la entrada de pandoc').toBe(delBuild);

      // -- siempre sobre los originales, nunca sobre dist/
      process.exitCode = 0;
      await runMerge(dirFalse, 'mi-coleccion.md', { format: 'markdown', output: 'salida/fusion.md' });
      expect(process.exitCode, 'merge sobre una collection debe exit 0').toBe(0);
      const fusion = await Bun.file(join(dirFalse, 'salida', 'fusion.md')).text();
      expect(fusion).toContain('## Autora A');
      expect(fusion).toContain('Contenido de doc.');
      expect(fusion).toContain('Contenido modificado.');
      expect(fusion).not.toContain('Intro de la colección.');

      // determinista: dos ejecuciones → mismos bytes
      await runMerge(dirFalse, 'mi-coleccion.md', { format: 'markdown', output: 'salida/fusion2.md' });
      const fusion2 = await Bun.file(join(dirFalse, 'salida', 'fusion2.md')).text();
      expect(fusion2).toBe(fusion);

      // sin --format o sin -o → error de uso
      process.exitCode = 0;
      await runMerge(dirFalse, 'mi-coleccion.md', { output: 'salida/sinformato.md' });
      expect(process.exitCode, 'sin --format debe fallar').toBe(1);
      process.exitCode = 0;
      await runMerge(dirFalse, 'mi-coleccion.md', { format: 'html' });
      expect(process.exitCode, 'sin -o debe fallar').toBe(1);

      // entrada que no es una collection → error
      process.exitCode = 0;
      await runMerge(dirFalse, 'dist/files/doc.md', { format: 'markdown', output: 'salida/nofu.md' });
      expect(process.exitCode, 'no-colección debe fallar').toBe(1);

      // un .md ya fusionado (merge:true) tampoco es una collection
      process.exitCode = 0;
      await runMerge(dirTrue, 'dist/files/mi-coleccion.md', { format: 'markdown', output: 'salida/yafusion.md' });
      expect(process.exitCode, 'type: file debe fallar').toBe(1);

      // -- al desactivar el markdown se retiran la collection y sus copias
      await Bun.write(join(dirFalse, 'iteraciones.config.yaml'), `${config({ markdown: false })}\n`);
      await runBuild(dirFalse);
      expect(existsSync(join(dist, 'mi-coleccion.md')), 'collection md retirada').toBe(false);
      expect(existsSync(join(dist, 'doc.md')), 'copia de miembro retirada').toBe(false);
      expect(existsSync(join(dist, 'other.md'))).toBe(false);
      expect(existsSync(join(dist, 'mi-coleccion.html')), 'el html no se toca').toBe(true);

      process.exitCode = 0;
    });
  }, 300_000);

  it('#2446: collectionCreator viaja al .md en los dos modos, con slug y byline', async () => {
    await withTempDir(async (dir) => {
      const collection = [
        '---',
        'title: Antología',
        'collectionCreator: [Editora Principal]',
        'type: collection',
        'files:',
        '  - doc.md',
        '  - ./other.md',
        '---',
        '',
        'Intro de la colección.',
        '',
      ].join('\n');
      const { runBuild } = await import('../cli/dispatcher.js');
      const SLUG = 'antologia-por-editora-principal';

      for (const merge of [false, true] as const) {
        const p = join(dir, merge ? 'verdadero' : 'falso');
        await mkdir(p, { recursive: true });
        await Bun.write(join(p, 'iteraciones.config.yaml'), `${config({ merge })}\n`);
        await Bun.write(join(p, 'antologia.md'), collection);
        await Bun.write(join(p, 'doc.md'), DOC);
        await Bun.write(join(p, 'other.md'), OTHER);

        process.exitCode = 0;
        await runBuild(p);
        expect(process.exitCode, `build con merge:${merge} debe exit 0`).toBe(0);

        const out = join(p, 'dist', 'files', `${SLUG}.md`);
        const md = await Bun.file(out).text();
        const head = md.slice(0, md.indexOf('\n---', 1));
        expect(head, `merge:${merge} conserva el crédito propio`).toContain('collectionCreator');
        expect(head, `merge:${merge} exporta el slug derivado de collectionCreator`).toContain(`slug: ${SLUG}`);
        if (merge) {
          // sin files[] que recalcular, el byline no es rederivable: viaja
          expect(head, 'merge:true trae la unión de los creator de files').toContain('\ncreator:');
          expect(head).toContain('Autora A');
          expect(head).toContain('Autora B');
        } else {
          expect(head, 'merge:false no trae creator: se recalcula de files[]').not.toContain('\ncreator:');
          expect(head, 'merge:false conserva files[] con los que se recalcula').toContain('\nfiles:');
        }

        const { runMarkdown } = await import('../cli/markdown.js');
        await mkdir(join(p, 'cli'), { recursive: true });
        process.exitCode = 0;
        await runMarkdown(p, 'antologia.md', { output: `cli/${SLUG}.md` });
        expect(process.exitCode, `iteraciones markdown con merge:${merge} debe exit 0`).toBe(0);
        const viaScript = await Bun.file(join(p, 'cli', `${SLUG}.md`)).text();
        expect(viaScript, `iteraciones markdown con merge:${merge} debe escribir lo mismo que el build`).toBe(md);

        // round-trip: dist como origen → mismo nombre y mismos bytes
        const rt = join(p, 'reproceso');
        await cp(join(p, 'dist', 'files'), rt, { recursive: true });
        await Bun.write(join(rt, 'iteraciones.config.yaml'), `${config({ merge })}\n`);
        process.exitCode = 0;
        await runBuild(rt);
        expect(process.exitCode, `re-proceso con merge:${merge} debe exit 0`).toBe(0);
        const deVuelta = await Bun.file(join(rt, 'dist', 'files', `${SLUG}.md`)).text();
        expect(deVuelta, `round-trip con merge:${merge} debe ser idéntico`).toBe(md);
      }

      process.exitCode = 0;
    });
  }, 300_000);
});
