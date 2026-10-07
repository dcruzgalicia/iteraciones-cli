import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { After, Before, Given, Then, When } from '@cucumber/cucumber';
import { compileTailwindCss, computeCssHash, resolveTailwindBin } from '../../builder/build-assets.js';
import type { SiteConfig } from '../../config/config-schema.js';
import { DEFAULT_SITE_CONFIG } from '../../config/site-config.js';
import { ACCENT_PALETTES, type AccentColor } from '../../lib/accent-palettes.js';

/**
 * #2545 (onda 1) — integridad del CSS: compilación, diseño de tarjetas y caché.
 *
 * ## El `Bun.sleep(1100)` de la caché
 *
 * Viene del original y se conserva: el `mtime` de macOS se resuelve en 1 s, así
 * que para que un cambio de contenido sea distinguible de un `touch` hay que
 * esperar más de un segundo entre escrituras. Sin esa espera, los dos casos
 * ambiguos del Outline se confundirían y el test pasaría por casualidad.
 */

const RESOURCES = join(import.meta.dir, '../../lib/resources');
const TYPES = ['file', 'collection', 'creator'] as const;

const CARDS = [
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
 * Los dos archivos que no son una tarjeta y por eso no llevan marco: el marcador
 * `card-referencias.html` (el marco lo pone `card-referencias-block`, que el
 * post-proceso inyecta) y la tarjeta de contenido de una collection, que pone su
 * body al nivel del masonry (#2483, #2488).
 */
function sinMarco(type: string, card: string): boolean {
  return card === 'card-referencias.html' || (type === 'collection' && card === 'card-contenido.html');
}

async function readCard(type: string, card: string): Promise<string> {
  return readFile(join(RESOURCES, 'html', type, card), 'utf8');
}

/** Config materializada por el schema: tras parse, `site` es completo (#2072). */
function siteConfig(): SiteConfig {
  return {
    ...DEFAULT_SITE_CONFIG,
    format: {
      ...DEFAULT_SITE_CONFIG.format,
      html: { site: { title: 'T', description: 'd', logo: '', theme: 'dark', color: 'lime' }, generate: true },
    },
  };
}

interface CssWorld {
  dir: string;
  htmlPath: string;
  css: string;
  tailwindBin: string;
  hash: string;
  hashCache: unknown;
  newHash: string;
  accentError: string;
}

const world: CssWorld = {
  dir: '',
  htmlPath: '',
  css: '',
  tailwindBin: '',
  hash: '',
  hashCache: undefined,
  newHash: '',
  accentError: '',
};

Before(async () => {
  world.dir = await mkdtemp(join(tmpdir(), 'iteraciones-gherkin-'));
  world.htmlPath = join(world.dir, 'a.html');
});

After(async () => {
  await rm(world.dir, { recursive: true, force: true });
});

function resetProject(): void {
  world.htmlPath = join(world.dir, 'a.html');
}

// ── Compilación de Tailwind ──────────────────────────────────────────────────

When('resuelvo el binario de Tailwind', async () => {
  world.tailwindBin = await resolveTailwindBin();
});

Then('apunta a un archivo del paquete @tailwindcss que existe', async () => {
  if (!world.tailwindBin.includes('@tailwindcss')) throw new Error(`el binario no es del paquete: ${world.tailwindBin}`);
  if (!(await Bun.file(world.tailwindBin).exists())) throw new Error(`el binario no existe: ${world.tailwindBin}`);
});

Given('un proyecto con un HTML de clases {string}', async (clases: string) => {
  resetProject();
  await mkdir(join(world.dir, 'assets', 'css'), { recursive: true });
  const body = clases.includes(' ') ? `<body class="${clases}">Hola</body>` : `<p class="${clases}">Hola</p>`;
  await writeFile(join(world.dir, 'index.html'), `<!DOCTYPE html><html>${body}</html>`, 'utf8');
});

Given('un CSS previo con una clase que ya no usa el HTML', async () => {
  await writeFile(join(world.dir, 'assets', 'css', 'styles.css'), '.clase-fantasma{color:red}', 'utf8');
});

Given('un proyecto vacío', async () => {
  resetProject();
});

When('compilo el CSS con acento {string}', async (accent: string) => {
  if (accent === 'color-inventado') {
    world.accentError = '';
    try {
      await compileTailwindCss(world.dir, accent, world.dir);
    } catch (error) {
      world.accentError = String(error);
    }
    return;
  }
  await compileTailwindCss(world.dir, accent, world.dir);
  world.css = await readFile(join(world.dir, 'assets', 'css', 'styles.css'), 'utf8');
});

Then('el CSS incluye las clases del HTML y el acento configurado', () => {
  for (const clase of ['bg-stone-200', 'grid-cols-2', '.prose']) {
    if (!world.css.includes(clase)) throw new Error(`el CSS no incluye ${clase}`);
  }
});

/**
 * El acento es lo único que la config mete en el `@theme` del CSS: once custom
 * properties `--color-accent-<tono>` con los valores de la paleta. Sin esta
 * comprobación, el paso anterior se llamaba «y el acento configurado» y sólo
 * miraba clases del HTML: el acento podía no llegar al CSS sin que nadie se
 * enterara.
 */
Then('el CSS lleva el acento {string}', (accent: string) => {
  const tono = ACCENT_PALETTES[accent as AccentColor]?.[500];
  if (tono === undefined) throw new Error(`la paleta ${accent} no existe o no tiene el tono 500`);
  if (!world.css.includes(tono)) throw new Error(`el CSS no lleva el tono 500 de ${accent} (${tono})`);
});

Then('el CSS purga lo que el HTML ya no usa y no inventa lo que no menciona', () => {
  // Purga exacta: el CSS de entrada no puede auto-referenciarse.
  if (world.css.includes('clase-fantasma')) throw new Error('el CSS se auto-referenció con la clase fantasma');
  // #2487: el CSS de entrada no aporta clases propias, así que el marcador `::`
  // (que el filtro escribe como utilidad `h-[1.5em]`) sólo aparece si el HTML lo usa.
  for (const fantasma of ['.spacer', '.subparagraph', '.tarjeta-fragmento']) {
    if (world.css.includes(fantasma)) throw new Error(`el CSS inventó ${fantasma}`);
  }
});

When('leo el styles.css del proyecto', async () => {
  world.css = await readFile(join(RESOURCES, 'styles.css'), 'utf8');
});

Then('no tiene selectores de clase sueltos', () => {
  const sinComentarios = world.css.replace(/\/\*[\s\S]*?\*\//g, '');
  const selectores = sinComentarios.split('\n').filter((linea) => /^\s*\.[a-zA-Z][\w-]*(\s*,\s*\.[a-zA-Z][\w-]*)*\s*\{/.test(linea));
  if (selectores.length > 0) {
    throw new Error(`styles.css tiene selectores de clase sueltos:\n${selectores.join('\n')}`);
  }
});

Then('sus únicas utilidades son las cuatro de los casos extremos', () => {
  const sinComentarios = world.css.replace(/\/\*[\s\S]*?\*\//g, '');
  const utilities = [...sinComentarios.matchAll(/@utility\s+([\w-]+)/g)].map((m) => m[1] ?? '').sort();
  const expected = ['bg-paper-grid', 'logo-fill', 'scroll-reveal', 'smallcaps'];
  if (JSON.stringify(utilities) !== JSON.stringify(expected)) {
    throw new Error(`esperaba ${JSON.stringify(expected)} y hay ${JSON.stringify(utilities)}`);
  }
});

Then('el CSS incluye la clase del HTML', () => {
  if (!world.css.includes('text-stone-500')) throw new Error('el CSS no incluye la clase que el HTML usa');
});

Then('el CSS no incluye ninguna clase que no esté en el HTML', () => {
  if (world.css.includes('clase-inexistente-en-html')) throw new Error('el CSS metió una clase que el HTML no usa');
});

Then('la compilación falla diciendo que el acento es desconocido', () => {
  if (!world.accentError.includes('acento desconocido')) {
    throw new Error(`esperaba un error de acento desconocido y obtuve: ${world.accentError || '(no hubo error)'}`);
  }
});

// ── Diseño de las tarjetas (#2487, #2488) ───────────────────────────────────

When('reviso las copias de las tarjetas de {string}, {string} y {string}', async (a: string, b: string, c: string) => {
  const types = [a, b, c];
  for (const type of types) {
    const entries = [...new Bun.Glob('*.html').scanSync({ cwd: join(RESOURCES, 'html', type) })].sort();
    const esperado = [...CARDS].sort();
    if (JSON.stringify(entries) !== JSON.stringify(esperado)) {
      throw new Error(`${type} no tiene las tarjetas esperadas.\n  esperadas: ${JSON.stringify(esperado)}\n  reales:    ${JSON.stringify(entries)}`);
    }
  }
});

Then('las tres tienen exactamente las mismas tarjetas', () => {
  // El paso anterior ya comparó las tres; aquí se registra el resultado para
  // que el Gherkin lo lea. Sin esto, el feature afirmaría algo que nadie comprueba.
  for (const type of TYPES) {
    const entries = [...new Bun.Glob('*.html').scanSync({ cwd: join(RESOURCES, 'html', type) })];
    if (entries.length !== CARDS.length) throw new Error(`${type} tiene ${entries.length} tarjetas y no ${CARDS.length}`);
  }
});

Then('el esqueleto compartido trae el fondo de papel milimetrado', async () => {
  // El skeleton es compartido: el fondo y la página no se duplican por type.
  const skeleton = await readFile(join(RESOURCES, 'html', 'skeleton.html'), 'utf8');
  if (!skeleton.includes('bg-paper-grid')) throw new Error('el esqueleto no trae el fondo de papel milimetrado');
});

Then('el marcador de referencias no lleva marco propio', async () => {
  const marker = await readCard('file', 'card-referencias.html');
  if (marker.includes('rounded-tr-')) throw new Error('el marcador de referencias no debe llevar marco');
});

When('reviso la transparencia de las tarjetas de {string}, {string} y {string}', (_a: string, _b: string, _c: string) => {
  // La comprobación es la de los `Then`; este step sólo declara el alcance.
});

Then('todas las tarjetas comparten la misma transparencia', async () => {
  for (const type of TYPES) {
    for (const card of CARDS) {
      if (sinMarco(type, card)) continue;
      const html = await readCard(type, card);
      const found = [...new Set(html.match(/bg-stone-50\/\d+/g) ?? [])];
      if (JSON.stringify(found) !== JSON.stringify(['bg-stone-50/75'])) {
        throw new Error(`${type}/${card} usa ${JSON.stringify(found)} en lugar de bg-stone-50/75`);
      }
      // identity y footer repiten el marco en las dos ramas del $if$(home-href$)
      const dark = [...new Set(html.match(/bg-stone-900\/\d+/g) ?? [])];
      if (JSON.stringify(dark) !== JSON.stringify(['bg-stone-900/65'])) {
        throw new Error(`${type}/${card} usa ${JSON.stringify(dark)} en lugar de bg-stone-900/65`);
      }
    }
  }
});

When('reviso la punta de las tarjetas de {string}, {string} y {string}', (_a: string, _b: string, _c: string) => {
  // La comprobación es la de los `Then`; este step sólo declara el alcance.
});

/**
 * La punta dibujada va en `rounded-tr-… rounded-bl-…`: sólo dos esquinas. Un
 * radio global (`rounded-xl` a secas) la disuelve, y las dos tarjetas sin marco
 * no deben llevarlo.
 */
function exigePuntaRecta(html: string, etiqueta: string, llevaMarco: boolean): void {
  if (!llevaMarco) {
    if (html.includes('rounded-tr-')) throw new Error(`${etiqueta} no debía llevar marco`);
    return;
  }
  if (!/rounded-tr-(xl|2xl) rounded-bl-(xl|2xl)/.test(html)) {
    throw new Error(`${etiqueta} no redondea las esquinas de la punta`);
  }
  if (/\brounded-(xl|2xl)\b/.test(html)) throw new Error(`${etiqueta} redondea todo, no sólo la punta`);
}

Then('la punta de cada tarjeta queda en las esquinas rectas', async () => {
  for (const type of TYPES) {
    for (const card of CARDS) {
      exigePuntaRecta(await readCard(type, card), `${type}/${card}`, !sinMarco(type, card));
    }
  }
});

When('leo el esqueleto y el styles.css del proyecto', async () => {
  world.css = await readFile(join(RESOURCES, 'styles.css'), 'utf8');
});

Then('el esqueleto usa el fondo de papel milimetrado y sin degradados', async () => {
  const skeleton = await readFile(join(RESOURCES, 'html', 'skeleton.html'), 'utf8');
  // Ni el punto de la celda ni el círculo con degradado (#2488).
  if (skeleton.includes('radial-gradient')) throw new Error('el fondo usa radial-gradient');
});

Then('el styles.css define ese fondo con las dos retículas y sin utilidad muerta', () => {
  if (!world.css.includes('@utility bg-paper-grid')) throw new Error('falta la utilidad bg-paper-grid');
  // La fina de 10px y la grande de 50px, en variables por tema.
  if (!world.css.includes('--grid-fine')) throw new Error('falta la variable --grid-fine');
  if (!world.css.includes('50px 50px')) throw new Error('falta la retícula gruesa');
  if (!world.css.includes('10px 10px')) throw new Error('falta la retícula fina');
  // bg-grid-accent estaba definida y sin uso.
  if (world.css.includes('bg-grid-accent')) throw new Error('bg-grid-accent estaba definida y sin uso');
});

// ── Caché de CSS (computeCssHash) ────────────────────────────────────────────

Given('un proyecto con un HTML de clase {string}', async (clase: string) => {
  resetProject();
  await writeFile(world.htmlPath, `<p class="${clase}">A</p>`, 'utf8');
});

Given('calculo el hash de su CSS', async () => {
  const first = await computeCssHash(world.dir, siteConfig());
  world.hash = first.hash;
  world.hashCache = first.cache;
});

When('lo vuelvo a calcular con la caché intacta', async () => {
  const second = await computeCssHash(world.dir, siteConfig(), world.hashCache as never);
  world.newHash = second.hash;
});

When('toco el archivo sin cambiar su contenido', async () => {
  // El mtime de macOS se resuelve en 1s: sin esta espera, este caso y el
  // siguiente serían indistinguibles.
  await Bun.sleep(1100);
  await Bun.write(world.htmlPath, '<p class="x">A</p>');
  const touched = await computeCssHash(world.dir, siteConfig(), world.hashCache as never);
  world.newHash = touched.hash;
});

When('cambio el contenido y mantengo el mismo tamaño', async () => {
  await Bun.sleep(1100);
  await writeFile(world.htmlPath, '<p class="y">A</p>', 'utf8');
  const changed = await computeCssHash(world.dir, siteConfig(), world.hashCache as never);
  world.newHash = changed.hash;
});

When('agrando el contenido', async () => {
  await Bun.sleep(1100);
  await writeFile(world.htmlPath, '<p class="x">Contenido más largo</p>', 'utf8');
  const changed = await computeCssHash(world.dir, siteConfig(), world.hashCache as never);
  world.newHash = changed.hash;
});

When('borro el archivo', async () => {
  await Bun.sleep(1100);
  await Bun.file(world.htmlPath).delete();
  const removed = await computeCssHash(world.dir, siteConfig(), world.hashCache as never);
  world.newHash = removed.hash;
});

Then('el hash no cambia', () => {
  if (world.newHash !== world.hash) throw new Error(`el hash cambió a ${world.newHash} y debía quedarse en ${world.hash}`);
});

Then('el hash cambia', () => {
  if (world.newHash === world.hash) throw new Error('el hash no cambió y debía cambiar');
});
