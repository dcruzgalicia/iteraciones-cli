import { describe, expect, it } from 'bun:test';
import { readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getPandocVersion } from '../lib/pandoc-runner.js';
import { initTestProject, registerSkip, SKIP_REASONS, withTempDir } from './helpers.js';

const pandocOk = await getPandocVersion().catch(() => null);
if (!pandocOk) registerSkip('cleanup-golden.test.ts', SKIP_REASONS.pandoc);

/**
 * Árboles dorados de dist/ (issue #2012): definen el contenido EXACTO que
 * debe quedar tras cada operación de limpieza. Las salidas usan el slug
 * efectivo htmlSlugFor(relativePath, slug) — index.md ⇒ index.* — y la
 * limpieza debe usar EL MISMO slug: un desajuste deja huérfanos.
 */

/** Árbol relativo de dist/files: rutas de archivos con las extensiones dadas. */
async function distTree(dir: string): Promise<string[]> {
  const files: string[] = [];
  const walk = async (rel: string): Promise<void> => {
    for (const entry of await readdir(join(dir, rel), { withFileTypes: true })) {
      if (entry.isDirectory()) await walk(join(rel, entry.name));
      else files.push(join(rel, entry.name).replaceAll('\\', '/'));
    }
  };
  await walk('.');
  return files.sort();
}

function expectNoOrphans(tree: string[], allowedDocs: string[], extensions: string[]): void {
  for (const doc of allowedDocs) {
    for (const ext of extensions) {
      expect(tree).toContain(`${doc}${ext}`);
    }
  }
  // Cero huérfanos: toda ruta del árbol pertenece a un documento permitido,
  // a los assets globales o al índice de navegación
  const known = new Set<string>(['css/styles.css', 'fonts/OFL.txt', 'index.html']);
  for (const path of tree) {
    const belongs = allowedDocs.some((doc) => extensions.some((ext) => path === `${doc}${ext}`));
    const isAsset = [...known].map((k) => k.split('/')[0]).some((root) => root !== undefined && path.startsWith(root));
    expect(belongs || isAsset || path.endsWith('.svg')).toBe(true);
  }
}

const ALL_FORMATS_CONFIG = [
  'language: es-MX',
  'format:',
  '  latex:',
  '    generate: true',
  '  html:',
  '    site:',
  '      title: T',
  '    generate: true',
  '  pdf:',
  '    generate: true',
  '  epub:',
  '    generate: true',
  '  markdown:',
  '    generate: true',
].join('\n');

describe.skipIf(!pandocOk)('árboles dorados de dist (#2012)', () => {
  it('desactivar formatos elimina también los index.* (slug de salida ≠ slug de título)', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      // index.md: su salida es index.*, NO portada.html (el bug original)
      await writeFile(join(dir, 'index.md'), '---\ntitle: Portada\n---\n\nInicio.\n', 'utf8');
      await writeFile(join(dir, 'iteraciones.config.yaml'), ALL_FORMATS_CONFIG, 'utf8');
      process.exitCode = 0;
      const { runBuild } = await import('../cli/dispatcher.js');
      await runBuild(dir);

      let tree = await distTree(join(dir, 'dist', 'files'));
      expect(tree).toContain('index.tex');
      expect(tree).toContain('index.epub');
      expect(tree).toContain('index.md');

      // Desactivar latex/pdf/epub/markdown: sus salidas DEBEN eliminarse
      await writeFile(
        join(dir, 'iteraciones.config.yaml'),
        ['language: es-MX', 'format:', '  html:', '    site:', '      title: T', '    generate: true'].join('\n'),
        'utf8',
      );
      process.exitCode = 0;
      await runBuild(dir);
      tree = await distTree(join(dir, 'dist', 'files'));
      expectNoOrphans(tree, ['index', 'test-document'], ['.html']);
      expect(tree).not.toContain('index.tex');
      expect(tree).not.toContain('index.pdf');
      expect(tree).not.toContain('index.epub');
      expect(tree).not.toContain('index.md');
    });
  }, 180_000);

  it('cambiar el slug manual limpia las salidas del slug anterior', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(join(dir, 'test.md'), '---\ntitle: Test Document\nslug: mi-url-vieja\n---\n\nContenido.\n', 'utf8');
      process.exitCode = 0;
      const { runBuild } = await import('../cli/dispatcher.js');
      await runBuild(dir);
      expect(await distTree(join(dir, 'dist', 'files'))).toContain('mi-url-vieja.html');

      await writeFile(join(dir, 'test.md'), '---\ntitle: Test Document\nslug: mi-url-nueva\n---\n\nContenido.\n', 'utf8');
      process.exitCode = 0;
      await runBuild(dir);
      const tree = await distTree(join(dir, 'dist', 'files'));
      expect(tree).toContain('mi-url-nueva.html');
      expect(tree).not.toContain('mi-url-vieja.html');
    });
  });

  it('borrar un documento deja dist sin archivos ni directorios residuales', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await mkdir2(join(dir, 'posts'));
      await writeFile(join(dir, 'posts', 'borrable.md'), '---\ntitle: Borrable\n---\n\nTexto.\n', 'utf8');
      process.exitCode = 0;
      const { runBuild } = await import('../cli/dispatcher.js');
      await runBuild(dir);
      expect(await distTree(join(dir, 'dist', 'files'))).toContain('posts/borrable.html');

      await rm(join(dir, 'posts', 'borrable.md'));
      process.exitCode = 0;
      await runBuild(dir);
      const tree = await distTree(join(dir, 'dist', 'files'));
      expect(tree).not.toContain('posts/borrable.html');
      // El directorio posts/ no debe quedar vacío en dist/
      expect(tree.some((p) => p.startsWith('posts/'))).toBe(false);
    });
  });
});

async function mkdir2(path: string): Promise<void> {
  const { mkdir } = await import('node:fs/promises');
  await mkdir(path, { recursive: true });
}
