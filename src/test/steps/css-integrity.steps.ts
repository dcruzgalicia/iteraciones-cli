import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { After, Before, Given, Then, When } from '@cucumber/cucumber';
import { compileCss, computeCssHash } from '../../builder/build-assets.js';
import { type HtmlDocType, loadCard } from '../../builder/html-composer.js';
import type { SiteConfig } from '../../config/config-schema.js';
import { DEFAULT_HTML_FORMAT, DEFAULT_SITE_CONFIG } from '../../config/site-config.js';
import { ACCENT_PALETTE_VALUES } from '../../lib/accent-palette-values.js';
import { ACCENT_COLORS, type AccentColor } from '../../lib/accent-palettes.js';
import { htmlStyle } from '../../lib/html-styles.js';

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
  return card === 'card-referencias.html' || card === 'card-identity.html' || (type === 'collection' && card === 'card-contenido.html');
}

async function readCard(type: string, card: string): Promise<string> {
  return loadCard(type as HtmlDocType, card);
}

function siteConfig(overrides: { style?: string; color?: string; theme?: 'light' | 'dark' } = {}): SiteConfig {
  const style = htmlStyle(overrides.style);
  return {
    ...DEFAULT_SITE_CONFIG,
    format: {
      ...DEFAULT_SITE_CONFIG.format,
      html: {
        site: {
          title: 'T',
          description: 'd',
          logo: '',
          logoSize: '100px',
          theme: overrides.theme ?? 'light',
          style,
          color: (overrides.color ?? 'lime') as never,
          showDates: false,
          rss: false,
        },
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
  hash: string;
  newHash: string;
  accentError: string;
  style: string;
  theme: 'light' | 'dark';
  accent: string;
}

const world: CssWorld = {
  dir: '',
  htmlPath: '',
  css: '',
  hash: '',
  newHash: '',
  accentError: '',
  style: 'clasico',
  theme: 'light',
  accent: 'lime',
};

Before(async () => {
  world.dir = await mkdtemp(join(tmpdir(), 'iteraciones-gherkin-'));
  world.htmlPath = join(world.dir, 'a.html');
});

After(async () => {
  await rm(world.dir, { recursive: true, force: true });
});

function resetProject(): void {
  world.css = '';
  world.hash = '';
  world.newHash = '';
  world.accentError = '';
  world.style = 'clasico';
  world.theme = 'light';
  world.accent = 'lime';
}

Given('un proyecto vacío', () => {
  resetProject();
});

When('compilo el CSS con acento {string}, estilo {string} y tema {string}', async (accent: string, style: string, theme: string) => {
  world.accent = accent;
  world.style = htmlStyle(style);
  world.theme = theme === 'dark' ? 'dark' : 'light';
  if (!ACCENT_COLORS.includes(accent as AccentColor)) {
    try {
      await compileCss(world.dir, accent, world.style as never, world.theme);
    } catch (error) {
      world.accentError = String(error);
    }
    return;
  }
  await compileCss(world.dir, accent, world.style as never, world.theme);
  world.css = await readFile(join(world.dir, 'assets', 'css', 'styles.css'), 'utf8');
});

When('compilo el CSS con acento {string}', async (accent: string) => {
  await compileCss(world.dir, accent).then(
    async () => {
      world.css = await readFile(join(world.dir, 'assets', 'css', 'styles.css'), 'utf8');
    },
    (error) => {
      world.accentError = String(error);
    },
  );
});

Then('el CSS lleva el acento {string}', (accent: string) => {
  if (!ACCENT_COLORS.includes(accent as AccentColor)) throw new Error(`la paleta ${accent} no existe`);
  const value = ACCENT_PALETTE_VALUES[accent as AccentColor][500];
  if (value === undefined) throw new Error(`la paleta ${accent} no tiene el tono 500`);
  const definido = /--color-accent-500:([^;}]+)/.exec(world.css)?.[1];
  if (definido === undefined) throw new Error('el CSS no define el tono 500 del acento');
  if (Bun.color(definido, 'hex') !== Bun.color(value, 'hex')) throw new Error(`el CSS no lleva el valor del tono 500 de ${accent}`);
});

Then('el CSS lleva el estilo {string}', (style: string) => {
  if (!world.css.includes(`data-style=${style}`)) throw new Error(`el CSS no lleva el estilo ${style}`);
});

Then('el CSS no lleva el estilo {string}', (style: string) => {
  if (world.css.includes(`data-style=${style}`)) throw new Error(`el CSS lleva el estilo ${style} y no debería`);
});

Then('el CSS lleva el tema oscuro', () => {
  if (!world.css.includes('color-scheme:dark')) throw new Error('el CSS no lleva el tema oscuro');
});

Then('el CSS no lleva reglas de tema oscuro', () => {
  if (world.css.includes('color-scheme:dark')) throw new Error('el CSS lleva reglas de tema oscuro y no debería');
});

Then('el CSS no tiene comentarios ni saltos de línea', () => {
  if (world.css.includes('/*') || world.css.includes('\n')) throw new Error('el CSS no está minificado');
});

Then('el CSS pesa menos de {int} bytes', (bytes: number) => {
  const peso = Buffer.byteLength(world.css, 'utf8');
  if (peso >= bytes) throw new Error(`el CSS pesa ${peso} bytes y debe pesar menos de ${bytes}`);
});

Then('el CSS mezcla el acento en el fondo de las tarjetas', () => {
  if (!world.css.includes('--card-bg:color-mix')) throw new Error('el fondo de las tarjetas no mezcla el acento');
  if (!world.css.includes('var(--color-accent-500)')) throw new Error('el fondo de las tarjetas no usa el acento');
});

Then('el CSS mezcla el acento en el fondo del sitio', () => {
  if (!world.css.includes('--paper-bg:color-mix')) throw new Error('el fondo del sitio no mezcla el acento');
});

Then('la compilación falla diciendo que el acento es desconocido', () => {
  if (!world.accentError.includes('acento desconocido')) {
    throw new Error(`esperaba un error de acento desconocido y obtuve: ${world.accentError || '(no hubo error)'}`);
  }
});

Then('el CSS da a {string} la propiedad {string}', (selector: string, propiedad: string) => {
  const bloque = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(world.css);
  if (bloque === null) throw new Error(`el CSS no tiene ninguna regla para ${selector}`);
  if (!(bloque[1] ?? '').includes(propiedad)) {
    throw new Error(`la regla ${selector} no declara ${propiedad}. Dice:\n${bloque[1]}`);
  }
});

Then('el CSS no tiene {string}', (texto: string) => {
  if (world.css.includes(texto)) throw new Error(`el CSS tiene ${texto} y no debería`);
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
  if (!skeleton.includes('class="sitio"')) throw new Error('el esqueleto no trae la clase del sitio');
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
      if (!html.includes('tarjeta')) throw new Error(`${type}/${card} no usa la clase tarjeta`);
    }
  }
});

When('leo el styles.css del proyecto', async () => {
  world.css = await readFile(join(RESOURCES, 'styles.css'), 'utf8');
});

Given('calculo el hash de su CSS', async () => {
  world.hash = await computeCssHash(siteConfig());
});

When('lo vuelvo a calcular con la misma config', async () => {
  world.newHash = await computeCssHash(siteConfig());
});

When('cambio el HTML sin tocar la config', async () => {
  await writeFile(world.htmlPath, '<p class="otra">Otro HTML</p>', 'utf8');
  world.newHash = await computeCssHash(siteConfig());
});

When('cambio el acento a {string}', async (accent: string) => {
  world.newHash = await computeCssHash(siteConfig({ color: accent }));
});

When('cambio el estilo a {string}', async (style: string) => {
  world.newHash = await computeCssHash(siteConfig({ style }));
});

When('cambio el tema a {string}', async (theme: string) => {
  world.newHash = await computeCssHash(siteConfig({ theme: theme === 'dark' ? 'dark' : 'light' }));
});

Then('el hash no cambia', () => {
  if (world.newHash !== world.hash) throw new Error(`el hash cambió a ${world.newHash} y debía quedarse en ${world.hash}`);
});

Then('el hash cambia', () => {
  if (world.newHash === world.hash) throw new Error('el hash no cambió y debía cambiar');
});
