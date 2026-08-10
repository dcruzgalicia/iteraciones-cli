#!/usr/bin/env bun
/**
 * Post-procesamiento mínimo del HTML (referencias) para las reproducciones
 * manuales. Es el mismo código del pipeline (render.ts): las referencias
 * (h1#referencias + div#refs) salen del article y se convierten en una
 * tarjeta del masonry, insertada en el marcador <!-- block:referencias -->.
 *
 * No es una réplica: importa las funciones reales del builder, así que el
 * comportamiento siempre coincide con el build.
 *
 * Uso: bun postprocess-html.ts <raw.html> <final.html>
 */
import { extractReferencesBlock, removeTocReferencesLink } from '../../../builder/render.js';

const [, , src, dst] = process.argv;
if (!src || !dst) {
  process.stderr.write('uso: bun postprocess-html.ts <raw.html> <final.html>\n');
  process.exit(2);
}

let html = await Bun.file(src).text();
html = removeTocReferencesLink(html);
const { html: htmlWithoutRefs, block } = extractReferencesBlock(html);
if (block) {
  html = htmlWithoutRefs.replace('<!-- block:referencias -->', block);
} else {
  html = htmlWithoutRefs;
}
await Bun.write(dst, html);
