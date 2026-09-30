import { join } from 'node:path';
import type { SiteConfig } from '../config/config-schema.js';
import { DEFAULT_HTML_BLOCKS, type HtmlBlockKey } from '../config/site-config.js';

const HTML_RESOURCES_DIR = join(import.meta.dir, '../lib/resources/html');

const HTML_CARDS: Record<HtmlBlockKey, string> = {
  header: 'card-identity.html',
  contenido: 'card-contenido.html',
  formatos: 'card-formatos.html',
  indice: 'card-indice.html',
  referencias: 'card-referencias.html',
  footer: 'card-identity-footer.html',
};

/**
 * Compone la plantilla HTML que pandoc recibe por `--template`. Dos piezas de
 * HTML viajan ya horneadas y no como variables de `argv` (#2445): el logo
 * (`$logo-block$`) y los `<li>` de formatos (los hrefs sí viajan por argv,
 * uno corto por formato: `--variable=fmt-epub:./doc.epub`).
 *
 * #2487 — `header` y `footer` no son columnas del masonry: van en su propia
 * banda, una columna centrada del ancho de una columna del contenido. El orden
 * de `format.html.blocks` sigue mandando para el resto, pero la posición de
 * esos dos ya no cambia dónde se renderizan.
 */
export async function composeHtmlTemplate(siteConfig: SiteConfig, logoInline?: string): Promise<string> {
  const skeleton = await Bun.file(join(HTML_RESOURCES_DIR, 'skeleton.html')).text();
  const order = siteConfig.format?.html?.blocks ?? [...DEFAULT_HTML_BLOCKS];
  const cards: string[] = [];
  let header = '';
  let footer = '';
  for (const key of order) {
    const card = await Bun.file(join(HTML_RESOURCES_DIR, HTML_CARDS[key])).text();
    if (key === 'header') header = card;
    else if (key === 'footer') footer = card;
    else cards.push(card);
  }
  const logoBlock = logoInline
    ? `<span class="flex h-10 w-10 shrink-0 items-center justify-center text-accent-500 logo-fill">${logoInline}</span>`
    : '';
  return skeleton
    .replace('<!-- header -->', () => header)
    .replace('<!-- footer -->', () => footer)
    .replace('<!-- cards -->', () => cards.join('\n'))
    .split('$logo-block$')
    .join(logoBlock);
}

export interface HtmlPageVars {
  title: string;
  siteTitle: string;
  tagline?: string;
  lang: string;
  theme?: string;
  accent?: string;
  css?: string;
  authorMeta?: string;
  docTitle?: string;
  subtitle?: string;
  date?: string;
  homeHref?: string;
  formats?: FormatsLink[];
  /** #2483: la página de una collection salta la tarjeta de contenido. */
  collection?: boolean;
}

type ExportFormatKey = 'pdf' | 'epub' | 'latex' | 'markdown';

export interface FormatsLink {
  href: string;
  key: ExportFormatKey;
  name: string;
  description: string;
}

/**
 * Marcador de que hay al menos un formato (la plantilla usa `$if(formats)$`);
 * los hrefs individuales viajan aparte, uno corto por formato (#2445).
 */
export function buildFormatsFlag(formats: FormatsLink[]): string | undefined {
  return formats.length > 0 ? '1' : undefined;
}

/** `--variable=fmt-pdf:./doc.pdf` — un valor corto por formato, nunca HTML. */
export function buildFormatsArgs(formats: FormatsLink[]): string[] {
  return formats.map((f) => `--variable=fmt-${f.key}:${f.href}`);
}
