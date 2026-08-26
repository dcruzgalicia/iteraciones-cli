/**
 * Post-procesado de la página HTML (issue #2033): extracción del bloque de
 * referencias generado por citeproc y limpieza del TOC. No es composición:
 * vive en su propio módulo, separado de html-composer.
 */

import { join } from 'node:path';
import { logWarning } from '../lib/logger.js';

const HTML_RESOURCES_DIR = join(import.meta.dir, '../lib/resources/html');

/**
 * Elimina del TOC el ítem que enlaza a #refs-heading (el header sintético que
 * inyecta el filtro internal/flags para link-citations; sin él, el TOC lo
 * incluiría). El ítem es el último li del TOC y no contiene sublistas
 * (header de nivel 1).
 */
export function removeTocReferencesLink(html: string): string {
  return html.replace(/<li>\s*<a href="#refs-heading"[^>]*>.*?<\/a>\s*<\/li>/gs, '');
}

/**
 * Carga el wrapper de la tarjeta Referencias (diseño en recurso, sin clases en
 * TS). Se compone una vez por build y se sustituye en cada página: el marcador
 * {{refs-list}} recibe el bloque extraído de citeproc.
 */
export function loadReferencesCardTemplate(): Promise<string> {
  return Bun.file(join(HTML_RESOURCES_DIR, 'card-referencias-block.html')).text();
}

/**
 * Extrae el bloque de referencias (h1#refs-heading + div#refs) del article y lo
 * devuelve como bloque del masonry con su marcador. El wrapper de la tarjeta
 * viene en `cardTemplate` (recurso card-referencias-block.html): aquí solo se
 * sustituye la lista extraída en `{{refs-list}}`. El id del heading es el
 * sintético que inyecta internal/flags.lua: un heading "Referencias" propio
 * del documento (id referencias) nunca se toca. El parse del cierre es
 * balanceado: las entradas csl-entry son divs anidados, el primer `</div>` no
 * cierra el bloque. Sin citas, no se genera bloque.
 */
export function extractReferencesBlock(html: string, cardTemplate: string): { html: string; block?: string } {
  const refsIdPos = html.indexOf('id="refs-heading"');
  const refsDivPos = html.indexOf('<div id="refs"');
  if (refsIdPos < 0 && refsDivPos < 0) return { html };

  const start = refsIdPos >= 0 ? html.lastIndexOf('<h1', refsIdPos) : refsDivPos;
  const divStart = html.indexOf('<div id="refs"', start);
  if (divStart < 0) {
    if (html.includes('<!-- block:referencias -->')) {
      // Heading sintético sin div#refs (citeproc sin entradas): eliminar el
      // heading y el marcador, sin tocar ningún heading del documento.
      if (refsIdPos >= 0 && start >= 0) {
        const h1End = html.indexOf('</h1>', start);
        if (h1End >= 0) html = html.slice(0, start) + html.slice(h1End + 5);
      }
      return { html: html.replace('<!-- block:referencias -->', '') };
    }
    return { html };
  }

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
    // HTML mal balanceado (causa típica: un filtro Lua propio que abre <div>
    // sin cerrarlo): extraer el bloque partiría la página. Se devuelve intacta
    // y el desbalance se hace visible (#2080).
    logWarning(`HTML mal balanceado: las referencias no se extrajeron del documento; revisa los filtros Lua propios (div sin cerrar)`, 'html');
    return { html };
  }
  const end = i;

  // La lista extraída (el div#refs completo) es el contenido dinámico; el
  // wrapper y el chip del heading viven en el recurso (cardTemplate).
  const listChunk = html.slice(divStart, end);
  const withoutBlock = html.slice(0, start) + html.slice(end);

  return { html: withoutBlock, block: cardTemplate.replace('{{refs-list}}', listChunk) };
}
