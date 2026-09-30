import { describe, expect, it } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { compileTailwindCss, computeCssHash, resolveTailwindBin } from '../builder/build-assets.js';
import type { SiteConfig } from '../config/config-schema.js';
import { DEFAULT_SITE_CONFIG } from '../config/site-config.js';
import { withTempDir } from './helpers.js';

/**
 * El CSS se compila escaneando SOLO los HTML de dist/files: el fixture
 * controla qué clases deben aparecer (presentes en el HTML) y cuáles no
 * (ausentes, incluidas las de un CSS previo que no debe auto-referenciarse).
 */
describe('compilación de Tailwind sobre dist/files', () => {
  it('resuelve el binario del CLI por módulos y apunta a un archivo existente', async () => {
    const bin = await resolveTailwindBin();
    expect(bin).toContain('@tailwindcss');
    expect(await Bun.file(bin).exists()).toBe(true);
  });
  it('incluye las clases del HTML final y el acento configurado; purga las ausentes', async () => {
    await withTempDir(async (dir) => {
      await mkdir(join(dir, 'assets', 'css'), { recursive: true });
      await writeFile(
        join(dir, 'index.html'),
        '<!DOCTYPE html><html class="bg-stone-200 text-accent-500"><body class="prose grid grid-cols-2">Hola</body></html>',
        'utf8',
      );
      // CSS previo con una clase que ya no está en el HTML: no debe
      // auto-referenciarse (purga exacta).
      await writeFile(join(dir, 'assets', 'css', 'styles.css'), '.clase-fantasma{color:red}', 'utf8');

      await compileTailwindCss(dir, 'rose', dir);

      const css = await Bun.file(join(dir, 'assets', 'css', 'styles.css')).text();
      expect(css).toContain('bg-stone-200');
      expect(css).toContain('grid-cols-2');
      expect(css).toContain('.prose');
      // El acento configurado (rose) se compila directamente, sin overrides
      expect(css).toContain('oklch(64.5% .246 16.439)'); // rose-500
      expect(css).not.toContain('clase-fantasma');
      // #2487: el CSS de entrada no aporta ninguna clase propia, así que el
      // marcador :: (que el filtro escribe como utilidad `h-[1.5em]`) solo
      // aparece si el HTML de la página lo usa
      expect(css).not.toContain('.spacer');
      expect(css).not.toContain('.subparagraph');
      expect(css).not.toContain('.tarjeta-fragmento');
    });
  });

  it('#2487: styles.css no define ninguna clase de CSS tradicional', async () => {
    const css = await Bun.file(join(import.meta.dir, '..', 'lib', 'resources', 'styles.css')).text();
    // lo único que puede traer clases son utilidades @utility (que el
    // escáner de Tailwind genera desde el HTML) y @keyframes
    const sinComentarios = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const selectoresDeClase = sinComentarios.split('\n').filter((linea) => /^\s*\.[a-zA-Z][\w-]*(\s*,\s*\.[a-zA-Z][\w-]*)*\s*\{/.test(linea));
    expect(selectoresDeClase, 'selectores de clase sueltos en styles.css').toEqual([]);
    // y las utilidades que quedan son las cuatro de los casos extremos
    const utilidades = [...sinComentarios.matchAll(/@utility\s+([\w-]+)/g)].map((m) => m[1]);
    expect(utilidades.sort()).toEqual(['bg-paper-grid', 'logo-fill', 'scroll-reveal', 'smallcaps']);
  });

  it('no incluye clases que no están en ningún HTML de dist/files', async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, 'index.html'), '<p class="text-stone-500">Hola</p>', 'utf8');
      await compileTailwindCss(dir, 'lime', dir);
      const css = await Bun.file(join(dir, 'assets', 'css', 'styles.css')).text();
      expect(css).toContain('text-stone-500');
      expect(css).not.toContain('clase-inexistente-en-html');
    });
  });

  it('un acento desconocido produce error de build', async () => {
    await withTempDir(async (dir) => {
      await expect(compileTailwindCss(dir, 'color-inventado', dir)).rejects.toThrow('acento desconocido');
    });
  });
});

/**
 * #2487 — el diseño de las tarjetas y del fondo: una sola opacidad para todas las
 * tarjetas, la punta dibujada en esquinas rectas, y el fondo como papel
 * milimetrado (dos retículas, sin puntos ni degradados).
 */
describe('diseño de las tarjetas y del fondo (#2487, #2488)', () => {
  const resources = join(import.meta.dir, '..', 'lib', 'resources');
  // #2488: las tarjetas viven en html/<type>/, una copia por type, y las tres
  // arrancan del mismo diseño, así que las invariantes se comprueban en todas.
  const types = ['file', 'collection', 'creator'] as const;
  const cards = [
    'card-contenido.html',
    'card-metadata.html',
    'card-formatos.html',
    'card-identity.html',
    'card-identity-footer.html',
    'card-indice.html',
    'card-referencias-block.html',
    'card-referencias.html',
  ];
  /**
   * Los dos archivos que no son una tarjeta y por eso no llevan marco: el
   * marcador `card-referencias.html` (el marco lo pone `card-referencias-block`,
   * que el post-proceso inyecta) y la tarjeta de contenido de una collection,
   * que pone su body al nivel del masonry (#2483, #2488).
   */
  const sinMarco = (type: string, card: string): boolean =>
    card === 'card-referencias.html' || (type === 'collection' && card === 'card-contenido.html');
  const read = (name: string): Promise<string> => Bun.file(join(resources, 'html', name)).text();

  it('las tres copias tienen las mismas siete tarjetas y ninguna más', async () => {
    for (const type of types) {
      const entries = [...new Bun.Glob('*.html').scanSync({ cwd: join(resources, 'html', type) })].sort();
      expect(entries, type).toEqual([...cards].sort());
    }
    // el skeleton es compartido: el fondo y la página no se duplican por type
    expect(await read('skeleton.html')).toContain('bg-paper-grid');
    // y el marcador de referencias no lleva marco: lo lleva su bloque
    expect(await Bun.file(join(resources, 'html', 'file', 'card-referencias.html')).text()).not.toContain('rounded-tr-');
  });

  it('todas las tarjetas comparten la misma transparencia', async () => {
    for (const type of types) {
      for (const card of cards) {
        if (sinMarco(type, card)) continue;
        const html = await Bun.file(join(resources, 'html', type, card)).text();
        // identity y footer repiten el marco en las dos ramas del $if$(home-href)$
        expect([...new Set(html.match(/bg-stone-50\/\d+/g) ?? [])], `${type}/${card}`).toEqual(['bg-stone-50/75']);
        expect([...new Set(html.match(/bg-stone-900\/\d+/g) ?? [])], `${type}/${card}`).toEqual(['bg-stone-900/65']);
      }
    }
  });

  it('la punta dibujada queda en las esquinas rectas', async () => {
    for (const type of types) {
      for (const card of cards) {
        const html = await Bun.file(join(resources, 'html', type, card)).text();
        if (sinMarco(type, card)) {
          expect(html, `${type}/${card}`).not.toContain('rounded-tr-');
          continue;
        }
        expect(html, `${type}/${card}`).toMatch(/rounded-tr-(xl|2xl) rounded-bl-(xl|2xl)/);
        // nada de radio global: si vuelve, la punta se disuelve en el redondeo
        expect(html, `${type}/${card}`).not.toMatch(/\brounded-(xl|2xl)\b/);
      }
    }
  });

  it('el fondo es papel milimetrado: dos retículas y ni un punto', async () => {
    const skeleton = await read('skeleton.html');
    expect(skeleton).toContain('bg-paper-grid');
    expect(skeleton, 'ni el punto de la celda ni el círculo con degradado').not.toContain('radial-gradient');
    const styles = await Bun.file(join(resources, 'styles.css')).text();
    expect(styles).toContain('@utility bg-paper-grid');
    expect(styles, 'la fina de 10px y la grande de 50px, en variables por tema').toContain('--grid-fine');
    expect(styles).toContain('50px 50px');
    expect(styles).toContain('10px 10px');
    expect(styles, 'bg-grid-accent estaba definida y sin uso').not.toContain('bg-grid-accent');
  });
});

describe('computeCssHash (caché por archivo mtime+size)', () => {
  // Defaults materializados por el schema: tras parse, site es completo (#2072)
  const config = (): SiteConfig => ({
    ...DEFAULT_SITE_CONFIG,
    format: {
      ...DEFAULT_SITE_CONFIG.format,
      html: { site: { title: 'T', description: 'd', logo: '', theme: 'dark', color: 'lime' }, generate: true },
    },
  });

  it('es estable con la caché intacta (mtime+size iguales: sin releer)', async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, 'a.html'), '<p class="x">A</p>', 'utf8');
      const first = await computeCssHash(dir, config());
      const second = await computeCssHash(dir, config(), first.cache);
      expect(second.hash).toBe(first.hash);
      expect(second.cache).toEqual(first.cache);
    });
  });

  it('un touch (mtime distinto, size igual) no cambia el hash (caso ambiguo resuelto por contenido)', async () => {
    await withTempDir(async (dir) => {
      const file = join(dir, 'a.html');
      await writeFile(file, '<p class="x">A</p>', 'utf8');
      const first = await computeCssHash(dir, config());
      // Asegurar mtime distinto (fs con resolución de 1s) y contenido idéntico
      await Bun.sleep(1100);
      await Bun.write(file, '<p class="x">A</p>');
      const touched = await computeCssHash(dir, config(), first.cache);
      expect(touched.hash).toBe(first.hash);
    });
  });

  it('un cambio de contenido con el mismo tamaño cambia el hash', async () => {
    await withTempDir(async (dir) => {
      const file = join(dir, 'a.html');
      await writeFile(file, '<p class="x">A</p>', 'utf8');
      const first = await computeCssHash(dir, config());
      await Bun.sleep(1100);
      await writeFile(file, '<p class="y">A</p>', 'utf8'); // mismo size, distinto contenido
      const changed = await computeCssHash(dir, config(), first.cache);
      expect(changed.hash).not.toBe(first.hash);
    });
  });

  it('un cambio de tamaño cambia el hash', async () => {
    await withTempDir(async (dir) => {
      const file = join(dir, 'a.html');
      await writeFile(file, '<p>A</p>', 'utf8');
      const first = await computeCssHash(dir, config());
      await Bun.sleep(1100);
      await writeFile(file, '<p class="x">Contenido más largo</p>', 'utf8');
      const changed = await computeCssHash(dir, config(), first.cache);
      expect(changed.hash).not.toBe(first.hash);
    });
  });

  it('los HTML eliminados dejan de participar en el hash', async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, 'a.html'), '<p class="x">A</p>', 'utf8');
      const first = await computeCssHash(dir, config());
      await Bun.sleep(1100);
      await Bun.file(join(dir, 'a.html')).delete();
      const removed = await computeCssHash(dir, config(), first.cache);
      expect(removed.hash).not.toBe(first.hash);
    });
  });
});
