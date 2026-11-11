import { join } from 'node:path';
import type { SiteConfig } from '../config/config-schema.js';
import { DEFAULT_HTML_FORMAT } from '../config/site-config.js';

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

const IDENTITY_APERTURA = '    <div id="card-identity" class="min-w-0">\n\n';
const FOOTER_APERTURA = '    <div id="card-identity-footer" class="min-w-0">\n';

function comoFooter(card: string): string {
  return card.replace(IDENTITY_APERTURA, FOOTER_APERTURA);
}

export function htmlResourceFiles(): string[] {
  return [...new Bun.Glob('**/*.html').scanSync({ cwd: HTML_RESOURCES_DIR, onlyFiles: true })].sort();
}

function logoSizeCss(value: string | undefined): string {
  const limpio = (value ?? '').trim();
  return /^\d+(\.\d+)?(px|rem|em|vw|vh|%)$/.test(limpio) ? limpio : DEFAULT_HTML_FORMAT.site.logoSize;
}

function logoIntrinsicSize(logoSize?: string): number {
  const px = Number.parseFloat(logoSizeCss(logoSize));
  return Number.isNaN(px) ? 100 : Math.round(px * 2);
}

export function logoBlockHtml(href: string, logoSize?: string, svg?: string): string {
  const size = logoIntrinsicSize(logoSize);
  const inner = svg ?? `<img src="${href}" alt="" width="${size}" height="${size}" class="block h-auto w-full">`;
  return `<span class="flex shrink-0 text-accent-500 logo-fill" style="width:${logoSizeCss(logoSize)}">${inner}</span>`;
}

export function creatorPortraitHtml(image: string, alt: string): string {
  return `<div class="min-w-0"><figure class="relative m-0 h-[30rem] overflow-hidden rounded-tr-2xl rounded-bl-2xl tarjeta sm:h-[32rem] lg:h-[34rem]"><img src="${Bun.escapeHTML(image)}" alt="${Bun.escapeHTML(alt)}" class="block h-full w-full object-cover object-center"></figure></div>`;
}

export const CHIP_OUTLINE_CLASSES =
  'not-prose inline-flex h-7 items-center rounded-full border border-accent-500/40 bg-transparent px-2.5 text-[11px] font-normal uppercase tracking-wide leading-none no-underline text-accent-700 sm:px-3 sm:text-xs lg:px-3.5 lg:text-sm dark:border-accent-400/40 dark:text-accent-300';

function frecuenciasInline(siteConfig: SiteConfig): string {
  const links = siteConfig.format?.html?.site?.links ?? [];
  if (links.length === 0) return '';
  const items = links
    .map(
      (link: { name: string; url: string }) =>
        `<a href="${Bun.escapeHTML(link.url)}" target="_blank" rel="noopener noreferrer" class="inline-flex h-7 items-center rounded-full border border-stone-500/60 bg-transparent px-2.5 text-[11px] font-semibold text-stone-600 no-underline transition-colors duration-200 hover:border-stone-600 hover:bg-stone-500/10 sm:px-3 sm:text-xs lg:px-3.5 lg:text-sm dark:border-stone-400/60 dark:bg-transparent dark:text-stone-300 dark:hover:bg-stone-500/10">${Bun.escapeHTML(link.name)}</a>`,
    )
    .join('');
  return `<nav aria-label="Redes" class="contents">${items}</nav>`;
}

function identityCard(children: string[]): string {
  return [
    '<div class="tarjeta relative rounded-tr-xl rounded-bl-xl p-4 ring-1 ring-inset ring-stone-300/60 dark:ring-stone-600/40 sm:p-6 lg:p-8">',
    '<div class="grid gap-8 sm:grid-cols-2 sm:gap-10 lg:gap-12">',
    ...children,
    '</div>',
    '</div>',
  ].join('\n');
}

function headerHtml(identity: string, menuHeader: string, redes: string): string {
  return identityCard([
    `<div class="min-w-0">${identity}</div>`,
    `<div class="flex flex-wrap items-start justify-center gap-2 sm:justify-end">${menuHeader}${redes}</div>`,
  ]);
}

function footerHtml(footerIdentity: string, menuFooterPlain: string, redes: string): string {
  return identityCard([
    `<div class="flex flex-wrap items-start justify-center gap-2 sm:justify-start">${menuFooterPlain}${redes}</div>`,
    `<div class="flex min-w-0 items-center justify-center sm:justify-start">${footerIdentity}</div>`,
  ]);
}

export async function composeHtmlTemplate(siteConfig: SiteConfig, type: HtmlDocType = 'file'): Promise<string> {
  const skeleton = await Bun.file(join(HTML_RESOURCES_DIR, 'skeleton.html')).text();
  const identity = await loadCard(type, 'card-identity.html');
  const footerIdentity = comoFooter(await loadCard(type, 'card-identity.html'));
  const metadata = await loadCard(type, 'card-metadata.html');
  const referencias = await loadCard(type, 'card-referencias.html');
  const mainCards = [await loadCard(type, 'card-contenido.html'), ...(type === 'file' ? [] : [referencias])];
  const relatedCards = [
    '$if(sidebar-extras)$$sidebar-extras$$endif$',
    await loadCard(type, 'card-indice.html'),
    await loadCard(type, 'card-formatos.html'),
    await loadCard('file', 'card-indice-coleccion.html'),
    ...(type === 'file' ? [referencias] : []),
  ];
  const siteCards = ['$if(recientes)$$recientes$$endif$', '$if(site-keywords)$$site-keywords$$endif$', await loadCard('file', 'card-licencia.html')];

  const redes = frecuenciasInline(siteConfig);
  const menuHeader = '$if(menu-header)$$menu-header$$endif$';
  const menuFooterPlain = '$if(menu-footer-plain)$$menu-footer-plain$$endif$';
  const header = headerHtml(identity, menuHeader, redes);
  const portadas = await loadCard('file', 'card-portadas.html');
  const esArchivo = type === 'file';
  const esCreador = type === 'creator';
  const main = esCreador
    ? `<div class="grid gap-4 sm:gap-6 creator-grid lg:gap-8">${mainCards[0] ?? ''}${'$if(extras)$$extras$$endif$'}${mainCards[1] ?? ''}${portadas}${'$if(pagination)$$pagination$$endif$'}</div>`
    : [portadas, ...mainCards, '$if(extras)$$extras$$endif$', '$if(pagination)$$pagination$$endif$'].join('\n');
  const pageGridClass = 'md:grid-cols-2 lg:grid-cols-3';
  const mainColClass = 'lg:col-span-2';
  const related = esArchivo ? relatedCards.join('\n') : '';
  const sidebar = [
    '$if(announcements-top)$$announcements-top$$endif$',
    ...(esArchivo ? [] : relatedCards),
    ...siteCards,
    '$if(announcements-bottom)$$announcements-bottom$$endif$',
  ].join('\n');
  const footer = footerHtml(footerIdentity, menuFooterPlain, redes);
  const relatedSlot = '<div id="slot-related" class="min-w-0 space-y-4 sm:space-y-6 empty:hidden lg:space-y-8"></div>';
  const relatedHtml =
    related === '' ? relatedSlot : `<div id="slot-related" class="min-w-0 space-y-4 sm:space-y-6 empty:hidden lg:space-y-8">${related}</div>`;

  return skeleton
    .replace('$page-grid-class$', pageGridClass)
    .replace('$main-col-class$', mainColClass)
    .replace(slot('header'), () => header)
    .replace(slot('page-header'), () => metadata)
    .replace(slot('main'), () => main)
    .replace(relatedSlot, () => relatedHtml)
    .replace(slot('sidebar'), () => sidebar)
    .replace(slot('footer'), () => footer);
}

export interface HtmlPageVars {
  title: string;
  siteTitle: string;
  tagline?: string;
  lang: string;

  logoBlock?: string;

  favicon?: string;

  keywords?: string;
  theme?: string;
  css?: string;
  iconTop?: string;
  authorMeta?: string;
  docTitle?: string;
  subtitle?: string;
  date?: string;
  dateIso?: string;
  showDates?: boolean;
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

  pageChips?: string;
  announcementsTop?: string;
  announcementsBottom?: string;
  indiceColeccion?: string;

  extras?: string;

  sidebarExtras?: string;

  recientes?: string;

  siteKeywords?: string;

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

export function buildFormatsArgs(formats: FormatsLink[]): string[] {
  return formats.map((f) => `--variable=fmt-${f.key}:${f.href}`);
}
