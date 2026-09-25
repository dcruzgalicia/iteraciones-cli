import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { cp, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { localizeDistAssets, relativizeTexForDist } from '../builder/latex-composer.js';
import { build } from '../builder/orchestrator.js';
import { runValidate } from '../cli/dispatcher.js';
import { loadSiteConfig } from '../config/config-loader.js';
import { getPandocVersion } from '../lib/pandoc-runner.js';
import { registerSkip, SKIP_REASONS, withTempDir } from './helpers.js';

/**
 * #2448 — `bundle: true` replica en `dist/files` los insumos de los que
 * dependen las salidas (config, preamble*, filters, bibliografía) para que una
 * copia de esa carpeta vuelva a construir el mismo build.
 *
 * Se verifica: (a) el schema y la regla que exige markdown exportado;
 * (b) que el build copie y retire lo copiado cuando se apaga; (c) que el
 * `build.sh` repita el comando; (d) que una copia de `dist/files` reconstruya
 * el mismo markdown; (e) que el .tex de dist no lleve rutas absolutas.
 *
 * pandoc/ImageMagick: skip informado si faltan (decisión D3).
 */
const pandocOk = await getPandocVersion().catch(() => null);
if (!pandocOk) registerSkip('bundle.test.ts', SKIP_REASONS.pandoc);

const magickOk = await Bun.spawn(['magick', '-version'], { stdout: 'ignore', stderr: 'ignore' })
  .exited.then((code) => code === 0)
  .catch(() => false);
if (!magickOk) registerSkip('bundle.test.ts', SKIP_REASONS.magick);

function resetExitCode(): void {
  process.exitCode = 0;
}

const DOC = ['---', 'title: Ensayo', '---', '', '## Capítulo', '', 'Contenido.'].join('\n');

function config(lines: string[]): string {
  return [
    'language: es-MX',
    'script: true',
    'bundle: true',
    'format:',
    '  html:',
    '    site:',
    '      title: T',
    '    generate: true',
    '  markdown:',
    '    generate: true',
    ...lines,
  ].join('\n');
}

/** Proyecto con los cuatro insumos que bundle debe replicar. */
async function setupProject(dir: string, yaml: string, doc = `${DOC}\n`): Promise<void> {
  await writeFile(join(dir, 'iteraciones.config.yaml'), `${yaml}\n`, 'utf8');
  await writeFile(join(dir, 'ensayo.md'), doc, 'utf8');
  await mkdir(join(dir, 'preamble'), { recursive: true });
  await writeFile(join(dir, 'preamble', '04-margins.tex'), '% margenes propios\n', 'utf8');
  await mkdir(join(dir, 'filters'), { recursive: true });
  await writeFile(join(dir, 'filters', 'mi-filtro.lua'), 'function Pandoc(doc) return doc end\n', 'utf8');
  await writeFile(join(dir, 'bibliography.bib'), '@book{ruiz2026, title = {Cuidar}},\n', 'utf8');
}

const REPLICATED = ['iteraciones.config.yaml', 'preamble/04-margins.tex', 'filters/mi-filtro.lua', 'bibliography.bib'];

describe('bundle en la config (#2448)', () => {
  afterEach(resetExitCode);

  it('por defecto es false y acepta true', async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, 'iteraciones.config.yaml'), 'language: es-MX\n', 'utf8');
      expect((await loadSiteConfig(dir)).bundle).toBe(false);

      await writeFile(join(dir, 'iteraciones.config.yaml'), 'language: es-MX\nbundle: true\n', 'utf8');
      expect((await loadSiteConfig(dir)).bundle).toBe(true);
    });
  });

  it('sin markdown exportado validate falla con el fix (#2448)', async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, 'iteraciones.config.yaml'), 'language: es-MX\nbundle: true\n', 'utf8');
      const spy = spyOn(process.stderr, 'write');
      let output = '';
      try {
        process.exitCode = 0;
        await runValidate(dir);
      } finally {
        output = spy.mock.calls.map((c) => String(c[0])).join('');
        spy.mockRestore();
      }
      expect(process.exitCode).toBe(1);
      expect(output).toContain('bundle: true requiere');
      expect(output).toContain('format.markdown.generate: true');
    });
  });

  // `build` resuelve la config antes de tocar nada; sin pandoc no arranca.
  it.skipIf(!pandocOk)(
    'build falla igual, antes de tocar nada (#2448)',
    async () => {
      await withTempDir(async (dir) => {
        await writeFile(join(dir, 'iteraciones.config.yaml'), 'language: es-MX\nbundle: true\n', 'utf8');
        await writeFile(join(dir, 'ensayo.md'), `${DOC}\n`, 'utf8');
        await expect(build(dir)).rejects.toThrow('bundle: true requiere');
      });
    },
    60_000,
  );
});

describe('relativizeTexForDist (#2448)', () => {
  const root = '/proy';
  const qr = '\\includegraphics{/proy/.iteraciones/processed-images/qr-abc.jpg}';

  it('reescribe la raíz relativa al propio .tex', () => {
    expect(relativizeTexForDist(qr, '/proy/dist/files', root)).toBe('\\includegraphics{../../.iteraciones/processed-images/qr-abc.jpg}');
    expect(relativizeTexForDist(qr, '/proy/dist/files/test', root)).toBe('\\includegraphics{../../../.iteraciones/processed-images/qr-abc.jpg}');
  });

  it('deja el .tex de trabajo y las rutas ajenas como estaban', () => {
    expect(relativizeTexForDist(qr, '/proy', root)).toBe(qr);
    expect(relativizeTexForDist('x=/otra/raiz/y', '/proy/dist/files', root)).toBe('x=/otra/raiz/y');
  });
});

describe('localizeDistAssets (#2450)', () => {
  it('mueve el QR del caché al assets/images del nivel y deja la copia', async () => {
    await withTempDir(async (dir) => {
      const raiz = await realpath(dir);
      const texDir = join(raiz, 'dist', 'files');
      const qr = join(raiz, '.iteraciones', 'processed-images', 'qr-abc123.jpg');
      await mkdir(dirname(qr), { recursive: true });
      await writeFile(qr, 'jpg', 'utf8');

      const out = await localizeDistAssets(`\\includegraphics{${qr}}`, {
        texDir,
        projectRoot: raiz,
        distRoot: texDir,
        bundle: false,
      });

      expect(out.tex).toBe('\\includegraphics{assets/images/qr-abc123.jpg}');
      expect(out.copies).toEqual([{ src: qr, rel: 'assets/images/qr-abc123.jpg' }]);
    });
  });

  it('la bibliografía apunta a la réplica de dist con bundle y se relativa sin él', async () => {
    await withTempDir(async (dir) => {
      const raiz = await realpath(dir);
      const texDir = join(raiz, 'dist', 'files');
      const bib = join(raiz, 'bibliografia.bib');
      await writeFile(bib, '@book{ruiz2026, title = {Cuidar}}\n', 'utf8');
      const tex = `\\addbibresource{${bib}}`;

      const con = await localizeDistAssets(tex, { texDir, projectRoot: raiz, distRoot: texDir, bundle: true });
      // bundle replica la bibliografía en la raíz de la salida: no hay que copiar nada
      expect(con.tex).toBe('\\addbibresource{bibliografia.bib}');
      expect(con.copies).toEqual([]);

      const sin = await localizeDistAssets(tex, { texDir, projectRoot: raiz, distRoot: texDir, bundle: false });
      expect(sin.tex).toBe('\\addbibresource{../../bibliografia.bib}');
      expect(sin.copies).toEqual([]);
    });
  });

  it('cualquier otra ruta bajo la raíz solo se relativa, sin copia', async () => {
    await withTempDir(async (dir) => {
      const raiz = await realpath(dir);
      const texDir = join(raiz, 'dist', 'files');
      await mkdir(join(raiz, 'preamble'), { recursive: true });
      const margen = join(raiz, 'preamble', '04-margins.tex');
      await writeFile(margen, '% margenes\n', 'utf8');

      const out = await localizeDistAssets(`\\input{${margen}}`, { texDir, projectRoot: raiz, distRoot: texDir, bundle: true });

      expect(out.tex).toBe('\\input{../../preamble/04-margins.tex}');
      expect(out.copies).toEqual([]);
    });
  });
});

describe.skipIf(!pandocOk)('bundle en el build (#2448)', () => {
  it('replica config, preamble, filters y bibliografía en dist/files', async () => {
    await withTempDir(async (dir) => {
      await setupProject(dir, config([]));
      await build(dir);

      const dist = join(dir, 'dist', 'files');
      for (const rel of REPLICATED) expect(await Bun.file(join(dist, rel)).exists(), rel).toBe(true);
      // la copia no arrastra la caché del proyecto original
      expect(await Bun.file(join(dist, '.iteraciones', 'bundle.json')).exists()).toBe(false);
      // el manifiesto vive en la caché, fuera de dist
      expect(await Bun.file(join(dir, '.iteraciones', 'bundle.json')).exists()).toBe(true);
      // y el .sh repite el mismo comando
      expect(await Bun.file(join(dir, 'build.sh')).text()).toContain('iteraciones bundle -o');
    });
  }, 60_000);

  it('bundle: false retira lo copiado en la siguiente corrida', async () => {
    await withTempDir(async (dir) => {
      await setupProject(dir, config([]));
      await build(dir);

      const dist = join(dir, 'dist', 'files');
      expect(await Bun.file(join(dist, 'iteraciones.config.yaml')).exists()).toBe(true);

      await setupProject(
        dir,
        config([])
          .split('\n')
          .filter((line) => !line.startsWith('bundle:'))
          .join('\n'),
      );
      await build(dir);

      for (const rel of REPLICATED) expect(await Bun.file(join(dist, rel)).exists(), rel).toBe(false);
      expect(await Bun.file(join(dir, '.iteraciones', 'bundle.json')).exists()).toBe(false);
      // las salidas siguen en pie
      expect(await Bun.file(join(dist, 'ensayo.md')).exists()).toBe(true);
    });
  }, 60_000);

  it('una copia de dist/files reconstruye el mismo markdown', async () => {
    await withTempDir(async (dir) => {
      await setupProject(dir, config([]));
      await build(dir);

      const copia = join(dir, 'copia');
      await cp(join(dir, 'dist', 'files'), copia, { recursive: true });
      await build(copia, { full: true });

      const original = await readFile(join(dir, 'dist', 'files', 'ensayo.md'));
      const rebuilt = await readFile(join(copia, 'dist', 'files', 'ensayo.md'));
      expect(rebuilt.equals(original)).toBe(true);
      // la copia también deja su propia réplica
      expect(await Bun.file(join(copia, 'dist', 'files', 'iteraciones.config.yaml')).exists()).toBe(true);
    });
  }, 60_000);
});

describe.skipIf(!pandocOk || !magickOk)('el .tex de dist no lleva rutas absolutas (#2448/#2450)', () => {
  it('el QR se copia a assets/images y el .tex apunta a esa copia', async () => {
    await withTempDir(async (dir) => {
      await setupProject(
        dir,
        config(['  latex:', '    generate: true']),
        `${DOC.replace('Contenido.', '[https://historikas.com]{.qr width="15mm"}')}\n`,
      );
      await build(dir);

      const dist = join(dir, 'dist', 'files');
      const tex = await readFile(join(dist, 'ensayo.tex'), 'utf8');
      const root = await realpath(dir);
      // #2450: el QR no queda en la caché del proyecto, vive en el assets del nivel
      expect(tex).toMatch(/\{assets\/images\/qr-[0-9a-f]+\.jpg\}/);
      expect(tex).not.toContain('.iteraciones/processed-images');
      const qr = (tex.match(/assets\/images\/(qr-[0-9a-f]+\.jpg)/) ?? [])[1];
      expect(qr).toBeDefined();
      expect(await Bun.file(join(dist, 'assets', 'images', qr as string)).exists()).toBe(true);
      // ninguna ruta absoluta del proyecto en un export
      expect(tex).not.toContain(root);
      expect(tex).not.toContain(dir);
    });
  }, 60_000);
});
