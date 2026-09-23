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

function config(opts: { merge?: boolean; markdown?: boolean } = {}): string {
  return [
    'language: es-MX',
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
      await Bun.write(join(dirFalse, 'iteraciones.config.yaml'), `${config()}\n`);
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

      // === `iteraciones merge` ===
      const { runMerge } = await import('../cli/merge.js');

      process.exitCode = 0;
      await runMerge(dirFalse, 'dist/files/mi-coleccion.md', { output: 'salida/fusion.md' });
      expect(process.exitCode, 'merge sobre una collection debe exit 0').toBe(0);
      const fusion = await Bun.file(join(dirFalse, 'salida', 'fusion.md')).text();
      expect(fusion).toContain('type: file');
      expect(fusion).not.toContain('files:');
      expect(fusion).toContain('## Autora A');
      expect(fusion).toContain('Contenido de other.');
      expect(fusion).not.toContain('Intro de la colección.');

      // determinista: dos ejecuciones → mismos bytes
      await runMerge(dirFalse, 'dist/files/mi-coleccion.md', { output: 'salida/fusion2.md' });
      const fusion2 = await Bun.file(join(dirFalse, 'salida', 'fusion2.md')).text();
      expect(fusion2).toBe(fusion);

      // sin -o → error de uso
      process.exitCode = 0;
      await runMerge(dirFalse, 'dist/files/mi-coleccion.md', {});
      expect(process.exitCode, 'sin -o debe fallar').toBe(1);

      // entrada que no es una collection → error
      process.exitCode = 0;
      await runMerge(dirFalse, 'dist/files/doc.md', { output: 'salida/nofu.md' });
      expect(process.exitCode, 'no-colección debe fallar').toBe(1);

      // un .md ya fusionado (merge:true) tampoco es una collection
      process.exitCode = 0;
      await runMerge(dirTrue, 'dist/files/mi-coleccion.md', { output: 'salida/yafusion.md' });
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
});
