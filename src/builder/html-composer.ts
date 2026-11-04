import { join } from 'node:path';
import type { SiteConfig } from '../config/config-schema.js';
import { DEFAULT_HTML_BLOCKS, DEFAULT_HTML_FORMAT, type HtmlBlockKey } from '../config/site-config.js';
import type { LogoAsset } from './build-assets.js';

export const HTML_RESOURCES_DIR = join(import.meta.dir, '../lib/resources/html');

export function slot(nombre: string): string {
  return `<div id="slot-${nombre}"></div>`;
}

export type HtmlDocType = 'file' | 'collection' | 'creator' | 'list' | 'menu' | 'announcement';

const CARD_DIRS: Record<HtmlDocType, string> = {
  file: 'file',
  collection: 'collection',
  creator: 'file',
  list: 'collection',
  menu: 'file',
  announcement: 'file',
};

export async function loadCard(type: HtmlDocType, name: string): Promise<string> {
  const own = Bun.file(join(HTML_RESOURCES_DIR, CARD_DIRS[type], name));
  return (await own.exists()) ? own.text() : Bun.file(join(HTML_RESOURCES_DIR, 'file', name)).text();
}

const HTML_CARDS: Record<HtmlBlockKey, string> = {
  header: 'card-identity.html',
  contenido: 'card-contenido.html',
  formatos: 'card-formatos.html',
  indice: 'card-indice.html',
  referencias: 'card-referencias.html',
  footer: 'card-identity.html',
};

const HTML_REGION: Record<HtmlBlockKey, 'header' | 'main' | 'sidebar' | 'footer'> = {
  header: 'header',
  contenido: 'main',
  formatos: 'sidebar',
  indice: 'sidebar',
  referencias: 'main',
  footer: 'footer',
};

const IDENTITY_APERTURA = '    <div id="card-identity" class="min-w-0">\n\n';
const FOOTER_APERTURA = '    <div id="card-identity-footer" class="min-w-0">\n';

function comoFooter(card: string): string {
  return card.replace(IDENTITY_APERTURA, FOOTER_APERTURA);
}

export function htmlResourceFiles(): string[] {
  return [...new Bun.Glob('**/*.html').scanSync({ cwd: HTML_RESOURCES_DIR, onlyFiles: true })].sort();
}

/** Una longitud CSS segura para el logo; si no lo es, el tamaño por defecto. */
function logoSizeCss(value: string | undefined): string {
  const limpio = (value ?? '').trim();
  return /^\d+(\.\d+)?(px|rem|em|vw|vh|%)$/.test(limpio) ? limpio : DEFAULT_HTML_FORMAT.site.logoSize;
}

/**
 * El bloque del logo para una página. El raster vive en `assets/` y se
 * referencia con una ruta relativa al nivel de la página; el SVG de fábrica va
 * incrustado para que herede el accent del tema.
 */
export function logoBlockHtml(logo: LogoAsset, href: string, logoSize?: string): string {
  const inner = logo.kind === 'inline' ? logo.html : `<img src="${href}" alt="" class="block h-auto w-full">`;
  return `<span class="flex shrink-0 text-accent-500 logo-fill" style="width:${logoSizeCss(logoSize)}">${inner}</span>`;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * El chip de pertenencia: contorno de acento, sin relleno. Lo comparten las
 * colecciones y la tarjeta de redes para decir de quién son los enlaces.
 */
export const CHIP_OUTLINE_CLASSES =
  'inline-block align-top rounded-full border border-accent-500/40 bg-transparent px-3 py-1 font-normal uppercase tracking-wide text-xs leading-none no-underline text-accent-700 dark:border-accent-400/40 dark:text-accent-300';

/** La tarjeta de «Frecuencias» con los enlaces del proyecto, o vacía si no hay. */
async function frecuenciasCard(siteConfig: SiteConfig): Promise<string> {
  const links = siteConfig.format?.html?.site?.links ?? [];
  if (links.length === 0) return '';
  const titulo = siteConfig.format?.html?.site?.title ?? '';
  const dueno = titulo === '' ? '' : `<span class="${CHIP_OUTLINE_CLASSES}">${escapeHtml(titulo)}</span>`;
  const items = links
    .map(
      (link: { name: string; url: string }) =>
        `<li><a href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer" class="text-accent-700 no-underline underline-offset-4 transition-colors duration-200 hover:underline hover:decoration-current dark:text-accent-300">${escapeHtml(link.name)}</a></li>`,
    )
    .join('\n          ');
  return (await loadCard('file', 'card-frecuencias.html')).replace('[[FRECUENCIAS]]', items).replace('[[DUENO]]', dueno);
}

export async function composeHtmlTemplate(siteConfig: SiteConfig, type: HtmlDocType = 'file'): Promise<string> {
  const skeleton = await Bun.file(join(HTML_RESOURCES_DIR, 'skeleton.html')).text();
  const html = siteConfig.format?.html;
  const order = (html !== undefined && 'blocks' in html && html.blocks) || [...DEFAULT_HTML_BLOCKS];
  const mainCards: string[] = [];
  const sidebarCards: string[] = [];
  let identity = '';
  let footerIdentity = '';
  let metadata = '';
  for (const key of order) {
    const card = await loadCard(type, HTML_CARDS[key]);
    const region = HTML_REGION[key];
    if (region === 'header') identity = card;
    else if (region === 'footer') footerIdentity = comoFooter(card);
    else if (region === 'main') mainCards.push(card);
    else sidebarCards.push(card);
    if (key === 'contenido') metadata = await loadCard(type, 'card-metadata.html');
    if (key === 'formatos') sidebarCards.push(await loadCard('file', 'card-indice-coleccion.html'));
  }

  const redes = await frecuenciasCard(siteConfig);
  const menuHeader = '$if(menu-header)$$menu-header$$endif$';
  const menuFooter = '$if(menu-footer)$$menu-footer$$endif$';
  const header = `<div class="grid items-start gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">${identity}${menuHeader}${redes}</div>`;
  const portadas = await loadCard('file', 'card-portadas.html');
  const main = [
    '$if(announcements-top)$$announcements-top$$endif$',
    portadas,
    '<div id="block-intro"></div>',
    ...mainCards,
    '$if(extras)$$extras$$endif$',
    '$if(announcements-bottom)$$announcements-bottom$$endif$',
    '$if(pagination)$$pagination$$endif$',
  ].join('\n');
  const sidebar = [
    ...(type === 'creator' ? [await loadCard('file', 'card-retrato.html')] : []),
    metadata,
    ...sidebarCards,
    '$if(sidebar-extras)$$sidebar-extras$$endif$',
    ...(type === 'list' || type === 'collection' || type === 'menu' ? [menuFooter, redes] : []),
  ].join('\n');
  const footer = `<div class="grid items-start gap-4 md:grid-cols-3"><div class="space-y-4">${footerIdentity}${redes}</div><div>${menuFooter}</div><div>$if(license)$$license$$endif$</div></div>`;

  return skeleton
    .replace(slot('header'), () => header)
    .replace(slot('main'), () => main)
    .replace(slot('sidebar'), () => sidebar)
    .replace(slot('footer'), () => footer);
}

export interface HtmlPageVars {
  title: string;
  siteTitle: string;
  tagline?: string;
  lang: string;
  /** El bloque del logo, ya resuelto para el nivel de la página. */
  logoBlock?: string;
  /** La ruta relativa del favicon. */
  favicon?: string;

  /** Las palabras clave del documento, ya unidas por comas para el <meta>. */
  keywords?: string;
  theme?: string;
  css?: string;
  authorMeta?: string;
  docTitle?: string;
  subtitle?: string;
  date?: string;
  homeHref?: string;
  formats?: FormatsLink[];

  titlehead?: string;
  subject?: string;
  publishers?: string;
  collectionCreatorPrefix?: string;

  docChip?: string;
  docChipHref?: string;
  contentChip?: string;
  frontCover?: string;
  backCover?: string;
  creatorImage?: string;
  creatorImageAlt?: string;
  license?: string;
  menuHeader?: string;
  menuFooter?: string;
  announcementsTop?: string;
  announcementsBottom?: string;
  indiceColeccion?: string;

  /** Las tarjetas de creadoras y de colecciones, ya en HTML. */
  extras?: string;

  /** Las tarjetas de información de la barra lateral, ya en HTML. */
  sidebarExtras?: string;

  /** El nav de paginación, ya en HTML. */
  pagination?: string;

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

export function buildFormatsFlag(formats: FormatsLink[]): string | undefined {
  return formats.length > 0 ? '1' : undefined;
}

export function buildFormatsArgs(formats: FormatsLink[]): string[] {
  return formats.map((f) => `--variable=fmt-${f.key}:${f.href}`);
}
