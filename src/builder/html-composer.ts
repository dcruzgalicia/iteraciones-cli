import { join } from 'node:path';
import type { SiteConfig } from '../config/config-schema.js';
import { DEFAULT_HTML_FORMAT } from '../config/site-config.js';
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

type HtmlCardKey = 'header' | 'contenido' | 'formatos' | 'indice' | 'referencias' | 'footer';

const HTML_ORDER: readonly HtmlCardKey[] = ['header', 'indice', 'formatos', 'contenido', 'referencias', 'footer'];

const HTML_CARDS: Record<HtmlCardKey, string> = {
  header: 'card-identity.html',
  contenido: 'card-contenido.html',
  formatos: 'card-formatos.html',
  indice: 'card-indice.html',
  referencias: 'card-referencias.html',
  footer: 'card-identity.html',
};

const HTML_REGION: Record<HtmlCardKey, 'header' | 'main' | 'sidebar' | 'footer'> = {
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

/** El retrato de la creadora como primera tarjeta de su cuadrícula. */
export function creatorPortraitHtml(image: string, alt: string): string {
  return `<div class="min-w-0"><figure class="relative m-0 h-[30rem] overflow-hidden rounded-tr-2xl rounded-bl-2xl tarjeta sm:h-[32rem] lg:h-[34rem]"><img src="${escapeHtml(image)}" alt="${escapeHtml(alt)}" class="block h-full w-full object-cover object-center"></figure></div>`;
}

/**
 * El chip de pertenencia: contorno de acento, sin relleno. Lo comparten las
 * colecciones y la tarjeta de redes para decir de quién son los enlaces.
 */
export const CHIP_OUTLINE_CLASSES =
  'not-prose inline-flex h-7 items-center rounded-full border border-accent-500/40 bg-transparent px-2.5 text-[11px] font-normal uppercase tracking-wide leading-none no-underline text-accent-700 sm:px-3 sm:text-xs lg:px-3.5 lg:text-sm dark:border-accent-400/40 dark:text-accent-300';

/** La fila de redes con los enlaces del proyecto, fuera de las tarjetas. */
function frecuenciasInline(siteConfig: SiteConfig): string {
  const links = siteConfig.format?.html?.site?.links ?? [];
  if (links.length === 0) return '';
  const items = links
    .map(
      (link: { name: string; url: string }) =>
        `<a href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer" class="inline-flex h-7 items-center rounded-full border border-stone-500/60 bg-transparent px-2.5 text-[11px] font-semibold text-stone-600 no-underline transition-colors duration-200 hover:border-stone-600 hover:bg-stone-500/10 sm:px-3 sm:text-xs lg:px-3.5 lg:text-sm dark:border-stone-400/60 dark:bg-transparent dark:text-stone-300 dark:hover:bg-stone-500/10">${escapeHtml(link.name)}</a>`,
    )
    .join('');
  return `<nav aria-label="Redes" class="contents">${items}</nav>`;
}

function headerHtml(identity: string, menuHeader: string, redes: string): string {
  return [
    '<div class="tarjeta relative rounded-tr-xl rounded-bl-xl p-4 ring-1 ring-inset ring-stone-300/60 dark:ring-stone-600/40 sm:p-6 lg:p-8">',
    '<div class="grid gap-8 sm:grid-cols-2 sm:gap-10 lg:gap-12">',
    `<div class="min-w-0">${identity}</div>`,
    `<div class="flex flex-wrap items-start justify-center gap-2 sm:justify-end">${menuHeader}${redes}</div>`,
    '</div>',
    '</div>',
  ].join('\n');
}

function footerHtml(footerIdentity: string, menuFooterPlain: string, redes: string): string {
  return [
    '<div class="tarjeta relative rounded-tr-xl rounded-bl-xl p-4 ring-1 ring-inset ring-stone-300/60 dark:ring-stone-600/40 sm:p-6 lg:p-8">',
    '<div class="grid gap-8 sm:grid-cols-2 sm:gap-10 lg:gap-12">',
    `<div class="flex flex-wrap items-start justify-center gap-2 sm:justify-start">${menuFooterPlain}${redes}</div>`,
    `<div class="flex min-w-0 items-center justify-center sm:justify-start">${footerIdentity}</div>`,
    '</div>',
    '</div>',
  ].join('\n');
}

export async function composeHtmlTemplate(siteConfig: SiteConfig, type: HtmlDocType = 'file'): Promise<string> {
  const skeleton = await Bun.file(join(HTML_RESOURCES_DIR, 'skeleton.html')).text();
  const mainCards: string[] = [];
  const sidebarCards: string[] = [];
  let identity = '';
  let footerIdentity = '';
  let metadata = '';
  for (const key of HTML_ORDER) {
    const card = await loadCard(type, HTML_CARDS[key]);
    const region = HTML_REGION[key];
    if (region === 'header') identity = card;
    else if (region === 'footer') footerIdentity = comoFooter(card);
    else if (region === 'main') mainCards.push(card);
    else sidebarCards.push(card);
    if (key === 'contenido') metadata = await loadCard(type, 'card-metadata.html');
    if (key === 'formatos') sidebarCards.push(await loadCard('file', 'card-indice-coleccion.html'));
  }

  const redes = frecuenciasInline(siteConfig);
  const menuHeader = '$if(menu-header)$$menu-header$$endif$';
  const menuFooterPlain = '$if(menu-footer-plain)$$menu-footer-plain$$endif$';
  const header = headerHtml(identity, menuHeader, redes);
  const portadas = await loadCard('file', 'card-portadas.html');
  const main = [portadas, ...mainCards, '$if(extras)$$extras$$endif$', '$if(pagination)$$pagination$$endif$'].join('\n');
  const sidebar = [
    '$if(announcements-top)$$announcements-top$$endif$',
    '$if(sidebar-extras)$$sidebar-extras$$endif$',
    ...sidebarCards,
    '$if(recientes)$$recientes$$endif$',
    '$if(site-keywords)$$site-keywords$$endif$',
    await loadCard('file', 'card-licencia.html'),
    '$if(announcements-bottom)$$announcements-bottom$$endif$',
  ].join('\n');
  const footer = footerHtml(footerIdentity, menuFooterPlain, redes);

  return skeleton
    .replace(slot('header'), () => header)
    .replace(slot('page-header'), () => metadata)
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
  iconTop?: string;
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
  menuFooterPlain?: string;
  /** Los chips de colecciones y keywords de la cabecera de página. */
  pageChips?: string;
  announcementsTop?: string;
  announcementsBottom?: string;
  indiceColeccion?: string;

  /** Las tarjetas de creadoras y de colecciones, ya en HTML. */
  extras?: string;

  /** Las tarjetas de información de la barra lateral, ya en HTML. */
  sidebarExtras?: string;
  /** La tarjeta de las entradas más recientes, ya en HTML. */
  recientes?: string;
  /** La tarjeta con todas las palabras clave del sitio, ya en HTML. */
  siteKeywords?: string;

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
