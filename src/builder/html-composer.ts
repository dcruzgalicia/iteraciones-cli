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

const IDENTITY_APERTURA = '<div id="card-identity"';
const FOOTER_APERTURA = '<div id="card-identity-footer"';

function comoFooter(card: string): string {
  return card.replace(IDENTITY_APERTURA, FOOTER_APERTURA).replace('class="sitio-marca"', 'class="sitio-marca sitio-marca--derecha"');
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
  const inner = svg ?? `<img src="${href}" alt="" width="${size}" height="${size}" class="sitio-logo__imagen">`;
  return `<span class="sitio-logo logo-fill" style="width:${logoSizeCss(logoSize)}">${inner}</span>`;
}

export function creatorPortraitHtml(image: string, alt: string): string {
  return `<figure class="retrato-pagina"><img src="${Bun.escapeHTML(image)}" alt="${Bun.escapeHTML(alt)}" class="retrato-pagina__imagen"></figure>`;
}

function frecuenciasInline(siteConfig: SiteConfig): string {
  const links = siteConfig.format?.html?.site?.links ?? [];
  if (links.length === 0) return '';
  const items = links
    .map(
      (link: { name: string; url: string }) =>
        `<a href="${Bun.escapeHTML(link.url)}" target="_blank" rel="noopener noreferrer" class="chip chip--red chip--enlace">${Bun.escapeHTML(link.name)}</a>`,
    )
    .join('');
  return `<nav aria-label="Redes" class="redes">${items}</nav>`;
}

function identityCard(children: string[]): string {
  return ['<div class="tarjeta tarjeta--identidad">', '<div class="identidad-grid">', ...children, '</div>', '</div>'].join('\n');
}

function headerHtml(identity: string, menuHeader: string, redes: string): string {
  return identityCard([`<div>${identity}</div>`, `<div class="sitio-acciones">${menuHeader}${redes}</div>`]);
}

function footerHtml(footerIdentity: string, menuFooterPlain: string, redes: string): string {
  return identityCard([
    `<div class="sitio-acciones sitio-acciones--pie">${menuFooterPlain}${redes}</div>`,
    `<div class="sitio-pie__identidad">${footerIdentity}</div>`,
  ]);
}

function fillSlot(html: string, name: string, content: string): string {
  const start = html.indexOf(`<div id="slot-${name}"`);
  if (start === -1) return html;
  const openEnd = html.indexOf('>', start);
  if (openEnd === -1) return html;
  const close = html.indexOf('</div>', openEnd);
  if (close === -1) return html;
  return html.slice(0, openEnd + 1) + content + html.slice(close);
}

export async function composeHtmlTemplate(siteConfig: SiteConfig, type: HtmlDocType = 'file'): Promise<string> {
  const skeleton = await Bun.file(join(HTML_RESOURCES_DIR, 'skeleton.html')).text();
  const identity = await loadCard(type, 'card-identity.html');
  const footerIdentity = comoFooter(await loadCard(type, 'card-identity.html'));
  const metadata = await loadCard(type, 'card-metadata.html');
  const referencias = await loadCard(type, 'card-referencias.html');
  const contenido = await loadCard(type, 'card-contenido.html');
  const relatedCards = [
    '$if(sidebar-extras)$$sidebar-extras$$endif$',
    await loadCard(type, 'card-indice.html'),
    await loadCard(type, 'card-formatos.html'),
    await loadCard('file', 'card-cita.html'),
    await loadCard('file', 'card-indice-coleccion.html'),
  ];
  const siteCards = ['$if(recientes)$$recientes$$endif$', '$if(site-keywords)$$site-keywords$$endif$', await loadCard('file', 'card-licencia.html')];

  const redes = frecuenciasInline(siteConfig);
  const menuHeader = '$if(menu-header)$$menu-header$$endif$';
  const menuFooterPlain = '$if(menu-footer-plain)$$menu-footer-plain$$endif$';
  const header = headerHtml(identity, menuHeader, redes);
  const contraportada = await loadCard('file', 'card-contraportada.html');
  const esCreador = type === 'creator';
  const pageType = esCreador ? 'creator' : type === 'collection' || type === 'list' ? 'collection' : 'file';
  const main = esCreador ? contenido : [contenido, '$if(extras)$$extras$$endif$', '$if(pagination)$$pagination$$endif$'].join('\n');
  const publications = esCreador ? ['$if(extras)$$extras$$endif$', '$if(pagination)$$pagination$$endif$'].join('\n') : '';
  const related = [contraportada, ...relatedCards, referencias].join('\n');
  const sidebar = ['$if(announcements-top)$$announcements-top$$endif$', ...siteCards, '$if(announcements-bottom)$$announcements-bottom$$endif$'].join(
    '\n',
  );
  const footer = footerHtml(footerIdentity, menuFooterPlain, redes);

  let html = skeleton
    .replace('$page-type-class$', `page-${pageType}`)
    .replace(slot('header'), () => header)
    .replace(slot('footer'), () => footer);
  html = fillSlot(html, 'hero', '$if(hero)$$hero$$endif$');
  html = fillSlot(html, 'page-header', metadata);
  html = fillSlot(html, 'main', main);
  html = fillSlot(html, 'publications', publications);
  html = fillSlot(html, 'related', related);
  html = fillSlot(html, 'sidebar', sidebar);
  return html;
}

export interface HtmlPageVars {
  title: string;
  siteTitle: string;
  tagline?: string;
  metaDescription?: string;
  canonical?: string;
  socialMeta?: string;
  jsonLd?: string;
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
  abstract?: string;
  hero?: string;
  style?: string;
  fontPreloads?: string;
  labelFormatos?: string;
  labelIndice?: string;
  labelReferencias?: string;
  date?: string;
  dateIso?: string;
  showDates?: boolean;
  homeHref?: string;
  formats?: FormatsLink[];

  titlehead?: string;
  subject?: string;
  collectionCreatorPrefix?: string;

  docChip?: string;
  docChipHref?: string;
  contentChip?: string;
  frontCover?: string;
  frontCoverAlt?: string;
  backCover?: string;
  creatorImage?: string;
  creatorImageAlt?: string;
  license?: string;
  menuHeader?: string;
  menuFooterPlain?: string;

  collectionChips?: string;
  keywordChips?: string;
  announcementsTop?: string;
  announcementsBottom?: string;
  indiceColeccion?: string;
  publicationMeta?: string;
  citationBlock?: string;

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
