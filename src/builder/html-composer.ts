import { join } from 'node:path';
import type { SiteConfig } from '../config/config-schema.js';
import { DEFAULT_HTML_BLOCKS, type HtmlBlockKey } from '../config/site-config.js';

const HTML_RESOURCES_DIR = join(import.meta.dir, '../lib/resources/html');

/**
 * #2488 — los types cuyo diseño HTML se compone. `intervention` no genera HTML
 * (`docProducesFormat`), así que no tiene copia.
 */
export type HtmlDocType = 'file' | 'collection' | 'creator';

/** #2488 — de dónde se lee cada tarjeta: `html/<type>/card-<clave>.html`. Las tres
 * copias son independientes y sin respaldo común: editar una no toca las otras. */
export function htmlCardsDir(type: HtmlDocType): string {
  return join(HTML_RESOURCES_DIR, type);
}

/** #2488 — la tarjeta de título (la otra mitad del bloque `contenido`) de un type. */
export function htmlMetadataCardPath(type: HtmlDocType): string {
  return join(htmlCardsDir(type), 'card-metadata.html');
}

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
 * #2487 — todo es un solo masonry: el skeleton tiene los cuatro marcadores
 * (`header`, `metadata`, `cards`, `footer`) dentro del `<main>`, y el bloque
 * `contenido` se parte en dos, la tarjeta del título (con el chip y los campos
 * del frontmatter) y la del cuerpo. El orden de `format.html.blocks` manda para
 * las tarjetas del medio; el header y el footer se quedan en sus marcadores, al
 * principio y al final.
 *
 * #2488 — las tarjetas se leen de `html/<type>/`: una copia independiente por
 * type. El skeleton y `styles.css` siguen siendo compartidos (el fondo es
 * global), pero las siete tarjetas de cada type son suyas, y como la copia ya
 * sabe su type, en ellas no queda ninguna rama `$if(collection)$`: la de
 * `collection` pone su body al nivel del masonry y las de `file`/`creator`
 * llevan la tarjeta de contenido.
 */
export async function composeHtmlTemplate(siteConfig: SiteConfig, logoInline?: string, type: HtmlDocType = 'file'): Promise<string> {
  const skeleton = await Bun.file(join(HTML_RESOURCES_DIR, 'skeleton.html')).text();
  const cardsDir = htmlCardsDir(type);
  const order = siteConfig.format?.html?.blocks ?? [...DEFAULT_HTML_BLOCKS];
  const cards: string[] = [];
  let header = '';
  let metadata = '';
  let footer = '';
  for (const key of order) {
    const card = await Bun.file(join(cardsDir, HTML_CARDS[key])).text();
    if (key === 'header') header = card;
    else if (key === 'footer') footer = card;
    else cards.push(card);
    if (key === 'contenido') metadata = await Bun.file(htmlMetadataCardPath(type)).text();
  }
  const logoBlock = logoInline
    ? `<span class="flex h-10 w-10 shrink-0 items-center justify-center text-accent-500 logo-fill">${logoInline}</span>`
    : '';
  return skeleton
    .replace('<!-- header -->', () => header)
    .replace('<!-- metadata -->', () => metadata)
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
  /** #2487: campos de la portada del PDF que solo vivían en LaTeX. */
  titlehead?: string;
  subject?: string;
  publishers?: string;
  collectionCreatorPrefix?: string;
  /** #2487: el chip de la banda de metadatos, según el type. */
  docChip?: string;
  /** #2487: las creadoras y el crédito propio de la collection, uno por
   * elemento: el filtro los une con ', ' dentro de un span nowrap, como el
   * \mbox de cada creator en LaTeX. */
  authors?: string[];
  collectionCreator?: string[];
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
