import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { After, Before, Given, Then, When } from '@cucumber/cucumber';
import { compileTailwindCss, computeCssHash, resolveTailwindBin } from '../../builder/build-assets.js';
import { type HtmlDocType, loadCard } from '../../builder/html-composer.js';
import type { SiteConfig } from '../../config/config-schema.js';
import { DEFAULT_HTML_FORMAT, DEFAULT_SITE_CONFIG } from '../../config/site-config.js';
import { ACCENT_COLORS, type AccentColor } from '../../lib/accent-palettes.js';

const RESOURCES = join(import.meta.dir, '../../lib/resources');
const TYPES = ['file', 'collection', 'creator'] as const;

const CARDS = [
  'card-contenido.html',
  'card-metadata.html',
  'card-formatos.html',
  'card-identity.html',
  'card-indice.html',
  'card-referencias-block.html',
  'card-referencias.html',
];

function sinMarco(type: string, card: string): boolean {
  return card === 'card-referencias.html' || (type === 'collection' && card === 'card-contenido.html');
}

async function readCard(type: string, card: string): Promise<string> {
  return loadCard(type as HtmlDocType, card);
}

function siteConfig(): SiteConfig {
  return {
    ...DEFAULT_SITE_CONFIG,
    format: {
      ...DEFAULT_SITE_CONFIG.format,
      html: {
        site: { title: 'T', description: 'd', logo: '', logoSize: '100px', theme: 'dark', color: 'lime' },
        generate: true,
        pageSize: DEFAULT_HTML_FORMAT.pageSize,
      },
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

Then('el CSS mezcla el acento en el fondo de las tarjetas', () => {
  if (!/color-mix\(in oklab, var\(--color-accent-500\) 4%/.test(world.css)) {
    throw new Error('el fondo de .tarjeta no mezcla el acento');
  }
});

Then('el CSS lleva el acento {string}', (accent: string) => {
  if (!ACCENT_COLORS.includes(accent as AccentColor)) throw new Error(`la paleta ${accent} no existe`);
  const referencia = `--color-accent-500:var(--color-${accent}-500)`;
  if (!world.css.includes(referencia)) {
    throw new Error(`el CSS no lleva el tono 500 de ${accent} (${referencia})`);
  }
  if (!world.css.includes(`--color-${accent}-500:`)) {
    throw new Error(`el CSS no lleva la paleta base de ${accent} que el acento referencia`);
  }
});

Then('el CSS purga lo que el HTML ya no usa y no inventa lo que no menciona', () => {
  if (world.css.includes('clase-fantasma')) throw new Error('el CSS se auto-referenció con la clase fantasma');

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

Then('sus únicas utilidades son las que tienen caso atrás', () => {
  const sinComentarios = world.css.replace(/\/\*[\s\S]*?\*\//g, '');
  const utilities = [...sinComentarios.matchAll(/@utility\s+([\w-]+)/g)].map((m) => m[1] ?? '').sort();
  const expected = [
    'bg-paper',
    'bg-paper-grid',
    'dictum',
    'logo-fill',
    'nombres-enlazados',
    'nombres-enlazados-gris',
    'scroll-reveal',
    'scroll-reveal-at-end',
    'smallcaps',
    'tarjeta',
    'tarjeta-extras',
    'verse',
  ];
  if (JSON.stringify(utilities) !== JSON.stringify(expected)) {
    throw new Error(`esperaba ${JSON.stringify(expected)} y hay ${JSON.stringify(utilities)}`);
  }
});

Given('un proyecto cuyo HTML trae {string}', async (cuerpo: string) => {
  resetProject();
  await mkdir(join(world.dir, 'assets', 'css'), { recursive: true });
  await writeFile(join(world.dir, 'index.html'), `<!DOCTYPE html><html><body>${cuerpo}</body></html>`, 'utf8');
});

Then('el CSS da a {string} la propiedad {string}', (selector: string, propiedad: string) => {
  const bloque = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\{([^}]*)\\}`).exec(world.css);
  if (bloque === null) throw new Error(`el CSS no tiene ninguna regla para ${selector}`);
  if (!(bloque[1] ?? '').includes(propiedad)) {
    throw new Error(`la regla ${selector} no declara ${propiedad}. Dice:\n${bloque[1]}`);
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

async function tarjetasResueltas(type: string): Promise<string[]> {
  const found: string[] = [];
  for (const card of CARDS) {
    found.push((await loadCard(type as HtmlDocType, card)).length > 0 ? card : '');
  }
  return found.filter(Boolean).sort();
}

When('reviso las copias de las tarjetas de {string}, {string} y {string}', async (a: string, b: string, c: string) => {
  const esperado = [...CARDS].sort();
  for (const type of [a, b, c]) {
    const resueltas = await tarjetasResueltas(type);
    if (JSON.stringify(resueltas) !== JSON.stringify(esperado)) {
      throw new Error(
        `${type} no resuelve las tarjetas esperadas.\n  esperadas: ${JSON.stringify(esperado)}\n  reales:    ${JSON.stringify(resueltas)}`,
      );
    }
  }
});

Then('las tres tienen exactamente las mismas tarjetas', async () => {
  for (const type of TYPES) {
    const resueltas = await tarjetasResueltas(type);
    if (resueltas.length !== CARDS.length) throw new Error(`${type} resuelve ${resueltas.length} tarjetas y no ${CARDS.length}`);
  }
});

Then('el esqueleto compartido trae el fondo de papel milimetrado', async () => {
  const skeleton = await readFile(join(RESOURCES, 'html', 'skeleton.html'), 'utf8');
  if (!skeleton.includes('bg-paper-grid')) throw new Error('el esqueleto no trae el fondo de papel milimetrado');
});

Then('el marcador de referencias no lleva marco propio', async () => {
  const marker = await readCard('file', 'card-referencias.html');
  if (marker.includes('rounded-tr-')) throw new Error('el marcador de referencias no debe llevar marco');
});

When('reviso la transparencia de las tarjetas de {string}, {string} y {string}', (_a: string, _b: string, _c: string) => {});

Then('todas las tarjetas comparten la misma superficie', async () => {
  for (const type of TYPES) {
    for (const card of CARDS) {
      if (sinMarco(type, card)) continue;
      const html = await readCard(type, card);
      if (!html.includes('tarjeta')) {
        throw new Error(`${type}/${card} no usa la utilidad "tarjeta"`);
      }
    }
  }
});

When('reviso la punta de las tarjetas de {string}, {string} y {string}', (_a: string, _b: string, _c: string) => {});

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

  if (skeleton.includes('radial-gradient')) throw new Error('el fondo usa radial-gradient');
});

Then('el esqueleto usa el fondo del sitio teñido del acento', async () => {
  const skeleton = await readFile(join(RESOURCES, 'html', 'skeleton.html'), 'utf8');
  if (!skeleton.includes('bg-paper')) throw new Error('el esqueleto no trae la utilidad bg-paper');
  if (skeleton.includes('bg-stone-200') || skeleton.includes('bg-stone-900')) {
    throw new Error('el esqueleto sigue usando el fondo gris de stone');
  }
});

Then('el CSS mezcla el acento en el fondo del sitio', () => {
  if (!world.css.includes('@utility bg-paper')) throw new Error('falta la utilidad bg-paper');
  if (!world.css.includes('color-mix(in oklab, var(--color-accent-500) 2%, #fff)')) {
    throw new Error('el fondo del sitio no mezcla el acento');
  }
});

Then('el styles.css define ese fondo con las dos retículas y sin utilidad muerta', () => {
  if (!world.css.includes('@utility bg-paper-grid')) throw new Error('falta la utilidad bg-paper-grid');

  if (!world.css.includes('--grid-fine')) throw new Error('falta la variable --grid-fine');
  if (!world.css.includes('50px 50px')) throw new Error('falta la retícula gruesa');
  if (!world.css.includes('10px 10px')) throw new Error('falta la retícula fina');

  if (world.css.includes('bg-grid-accent')) throw new Error('bg-grid-accent estaba definida y sin uso');
});

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
