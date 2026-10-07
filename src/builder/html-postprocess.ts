import { join } from 'node:path';
import { logWarning } from '../lib/logger.js';

const HTML_RESOURCES_DIR = join(import.meta.dir, '../lib/resources/html');

/**
 * Los dos huecos donde el post-proceso mete su contenido. Divs vacíos, no
 * comentarios: un minificador se lleva los comentarios y con ellos se rompe el
 * empalme con `html-composer`. Se sustituye el literal entero —apertura y
 * cierre— porque un `</div>` suelto dentro del masonry es un hueco visible.
 */
const REFS = '<div id="block-referencias"></div>';
const INTRO = '<div id="block-intro"></div>';

/** #2488 — el type de la página: cada uno tiene su propia tarjeta de referencias
 * en `html/<type>/card-referencias-block.html`. */
export type HtmlPostType = 'file' | 'collection' | 'creator';

export function removeTocReferencesLink(html: string): string {
  return html.replace(/<li>\s*<a href="#refs-heading"[^>]*>.*?<\/a>\s*<\/li>/gs, '');
}

/** #2488 — el bloque de la tarjeta de referencias de un type. */
export function loadReferencesCardTemplate(type: HtmlPostType): Promise<string> {
  return Bun.file(join(HTML_RESOURCES_DIR, type, 'card-referencias-block.html')).text();
}

/**
 * #2445/#2487 — fase de post-proceso HTML: las tres únicas cosas que cambian
 * respecto a la salida cruda de pandoc (quitarle el enlace al índice, colocar
 * la tarjeta de referencias y subir el body propio de la collection a su banda
 * de metadatos). El build y `iteraciones post html` llaman a esta misma
 * función, así que el build.sh reproduce el archivo final byte a byte.
 */
export function postProcessHtml(html: string, refsCardTemplate: string): string {
  const withIntro = moveCollectionIntro(removeTocReferencesLink(html));
  const { html: clean, block } = extractReferencesBlock(withIntro, refsCardTemplate);
  if (block === undefined) return clean;
  if (!clean.includes(REFS)) {
    logWarning('la tarjeta de referencias no está en format.html.blocks; la bibliografía no se inserta en la página', 'html');
    return clean;
  }
  return clean.replace(REFS, block);
}

/**
 * #2487 — el body propio de una collection (su intro) es markdown, así que
 * `collectionCardsContent` lo emite dentro del cuerpo de pandoc envuelto en un
 * div `collection-intro`. Aquí se saca de ahí y se coloca en el marcador de la
 * banda de metadatos, igual que la tarjeta de referencias con su bloque. El
 * marco del texto (prosa, alineado a la izquierda) lo pone esta misma función,
 * no la plantilla: así una collection sin intro no deja un div vacío ocupando
 * sitio en la tarjeta.
 */
export function moveCollectionIntro(html: string): string {
  const marker = INTRO;
  const divStart = html.indexOf('<div class="collection-intro"');
  if (divStart < 0) return html;
  const end = findBalancedDivEnd(html, divStart, 'el body propio de la collection');
  if (end === undefined) return html;
  const innerStart = html.indexOf('>', divStart) + 1;
  const inner = html.slice(innerStart, end - '</div>'.length).trim();
  const withoutIntro = html.slice(0, divStart) + html.slice(end);
  if (!withoutIntro.includes(marker)) {
    logWarning('la banda de metadatos no está en format.html.blocks; el cuerpo propio de la collection no se inserta en la página', 'html');
    return withoutIntro;
  }
  if (inner === '') return withoutIntro.replace(marker, '');
  const bloque = `<div class="mx-auto mt-10 max-w-none pt-6 text-left prose prose-xl dark:prose-invert [--tw-prose-links:var(--color-accent-600)] [--tw-prose-invert-links:var(--color-accent-500)]">${inner}</div>`;
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

function findBalancedDivEnd(html: string, divStart: number, que = 'las referencias'): number | undefined {
  let depth = 0;
  let i = divStart;
  while (i < html.length) {
    const open = html.indexOf('<div', i);
    const close = html.indexOf('</div>', i);
    if (close < 0) break;
    if (open >= 0 && open < close) {
      depth++;
      i = open + 4;
    } else {
      depth--;
      i = close + 6;
      if (depth === 0) break;
    }
  }
  if (depth !== 0) {
    logWarning(`HTML mal balanceado: ${que} no se extrajeron del documento; revisa los filtros Lua propios (div sin cerrar)`, 'html');
    return undefined;
  }
  return i;
}

export function extractReferencesBlock(html: string, cardTemplate: string): { html: string; block?: string } {
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
  return { html: html.slice(0, start) + html.slice(end), block: cardTemplate.replace('{{refs-list}}', listChunk) };
}
