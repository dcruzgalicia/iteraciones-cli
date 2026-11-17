import { logWarning } from '../lib/logger.js';
import { findBalancedDivEnd, type HtmlDocType, loadCard, slotBounds } from './html-composer.js';
import type { ImageDimensions } from './image-processor.js';

const REFS = '<div id="block-referencias"></div>';
const INTRO = '<div id="block-intro"></div>';

export function removeTocReferencesLink(html: string): string {
  return html.replace(/<li>\s*<a href="#refs-heading"[^>]*>.*?<\/a>\s*<\/li>/gs, '');
}

export function loadReferencesCardTemplate(type: HtmlDocType): Promise<string> {
  return loadCard(type, 'card-referencias-block.html');
}

function removeEmptySlot(html: string, name: string): string {
  const bounds = slotBounds(html, name);
  if (bounds === undefined) return html;
  const inner = html.slice(bounds.openEnd + 1, bounds.end - '</div>'.length);
  if (inner.trim() !== '') return html;
  return html.slice(0, bounds.start) + html.slice(bounds.end);
}

function removeEmptyGridSlots(html: string): string {
  let resultado = html;
  for (const name of ['publications', 'related', 'sidebar']) {
    resultado = removeEmptySlot(resultado, name);
  }
  return resultado.replace(/<aside id="slot-aside"[^>]*>\s*<\/aside>/, '');
}

export function postProcessHtml(html: string, refsCardTemplate: string, refsLabel = 'Referencias'): string {
  const withIntro = moveCollectionIntro(removeTocReferencesLink(html));
  const { html: clean, block } = extractReferencesBlock(withIntro, refsCardTemplate, refsLabel);
  if (block === undefined) return removeEmptyGridSlots(clean);
  if (!clean.includes(REFS)) {
    logWarning('no se encontró el marcador de la tarjeta de referencias; la bibliografía no se inserta en la página', 'html');
    return removeEmptyGridSlots(clean);
  }
  return removeEmptyGridSlots(clean.replace(REFS, block));
}

export function moveCollectionIntro(html: string): string {
  const marker = INTRO;
  const divStart = html.indexOf('<div class="collection-intro');
  if (divStart < 0) return html.replace(marker, '');
  const end = findBalancedDivEnd(html, divStart, 'el body propio de la collection');
  if (end === undefined) return html;
  const innerStart = html.indexOf('>', divStart) + 1;
  const inner = html.slice(innerStart, end - '</div>'.length).trim();
  const withoutIntro = html.slice(0, divStart) + html.slice(end);
  if (!withoutIntro.includes(marker)) {
    logWarning('no se encontró la banda de metadatos; el cuerpo propio de la collection no se inserta en la página', 'html');
    return withoutIntro;
  }
  if (inner === '') return withoutIntro.replace(marker, '');
  const bloque = `<div class="intro-coleccion prose contenido-tamano contenido-compacto">${inner}</div>`;
  return withoutIntro.replace(marker, () => bloque);
}

function stripSyntheticReferencesMarker(html: string, refsIdPos: number, start: number): string {
  let cleaned = html;
  if (refsIdPos >= 0 && start >= 0) {
    const headingEnd = cleaned.indexOf('</h', start);
    if (headingEnd >= 0) {
      const tagEnd = cleaned.indexOf('>', headingEnd);
      if (tagEnd >= 0) cleaned = cleaned.slice(0, start) + cleaned.slice(tagEnd + 1);
    }
  }
  return cleaned.replace(REFS, '');
}

export function extractReferencesBlock(html: string, cardTemplate: string, refsLabel = 'Referencias'): { html: string; block?: string } {
  const refsIdPos = html.indexOf('id="refs-heading"');
  const refsDivPos = html.indexOf('<div id="refs"');
  if (refsIdPos < 0 && refsDivPos < 0) return { html };

  const start = refsIdPos >= 0 ? Math.max(html.lastIndexOf('<h1', refsIdPos), html.lastIndexOf('<h5', refsIdPos)) : refsDivPos;
  const divStart = html.indexOf('<div id="refs"', start);
  if (divStart < 0) {
    if (!html.includes(REFS)) return { html };
    return { html: stripSyntheticReferencesMarker(html, refsIdPos, start) };
  }

  const end = findBalancedDivEnd(html, divStart);
  if (end === undefined) return { html };

  const listChunk = html.slice(divStart, end);
  return {
    html: html.slice(0, start) + html.slice(end),
    block: cardTemplate.replace('{{refs-list}}', listChunk).replace('{{label-referencias}}', refsLabel),
  };
}

export function addImageAttributes(html: string, sizes: Map<string, ImageDimensions> | undefined): string {
  if (sizes === undefined || sizes.size === 0) return html;
  return html.replace(/<img\b[^>]*>/g, (tag) => {
    const src = /src="([^"]+)"/.exec(tag)?.[1];
    if (src === undefined) return tag;
    const base = src.split('/').pop();
    if (base === undefined) return tag;
    const dimensions = sizes.get(base);
    if (dimensions === undefined) return tag;
    const width = /\swidth="/.test(tag) ? '' : ` width="${dimensions.width}"`;
    const height = /\sheight="/.test(tag) ? '' : ` height="${dimensions.height}"`;
    let salida = tag.replace(/\s*\/?>$/, (fin) => `${width}${height}${fin}`);
    if (
      !salida.includes('loading=') &&
      !tag.includes('tarjeta-imagen__img') &&
      !tag.includes('hero__imagen') &&
      !tag.includes('portada') &&
      !tag.includes('contenido-retrato') &&
      !tag.includes('retrato__img') &&
      !tag.includes('retrato-pagina__imagen') &&
      !tag.includes('width:100px')
    ) {
      salida = salida.replace('<img', '<img loading="lazy" decoding="async"');
    }
    return salida;
  });
}
