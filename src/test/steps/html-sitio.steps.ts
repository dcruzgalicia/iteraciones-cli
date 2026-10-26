import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Given, Then } from '@cucumber/cucumber';
import { escribirEnProyecto, world } from './cli-world.steps.ts';

function leer(relativa: string): string {
  return readFileSync(join(world.root, relativa), 'utf8');
}

const CONFIG_BASE = ['language: es-MX', 'format:', '  html:', '    generate: true'];

Given('el sitio declara los enlaces:', (tabla: string) => {
  const enlaces = tabla
    .split('\n')
    .map((linea) => linea.trim())
    .filter((linea) => linea !== '')
    .map((linea) => {
      const [name, url] = linea.split('|').map((parte) => parte.trim());
      return `        - name: ${name}\n          url: ${url}`;
    });
  escribirEnProyecto('iteraciones.config.yaml', [...CONFIG_BASE, '    site:', '      links:', ...enlaces].join('\n') + '\n');
});

Then('las tarjetas de Redes van después del header y antes del footer', () => {
  const html = leer('dist/files/test-document.html');
  const header = html.indexOf('id="card-identity"');
  const titulo = html.indexOf('<h1');
  const footer = html.indexOf('id="card-identity-footer"');
  const frecuencias = [...html.matchAll(/Redes/g)].map((m) => m.index ?? -1);
  if (frecuencias.length !== 2) throw new Error(`hay ${frecuencias.length} tarjetas de Redes y deberían ser 2`);
  const [primera, segunda] = frecuencias as [number, number];
  if (!(header < primera && primera < titulo)) throw new Error('la primera Redes no va después del header y antes del título');
  if (!(segunda < footer)) throw new Error('la segunda Redes no va antes del footer');
});

Given('el proyecto produce html y markdown', () => {
  escribirEnProyecto('iteraciones.config.yaml', 'language: es-MX\nformat:\n  html:\n    generate: true\n  markdown:\n    generate: true\n');
});

const CONFIG_HTML = 'language: es-MX\nformat:\n  html:\n    generate: true\n';

function escaparRegex(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

Given('un proyecto con un texto en dos colecciones', () => {
  escribirEnProyecto('iteraciones.config.yaml', CONFIG_HTML);
  escribirEnProyecto('ensayo.md', '---\ntitle: Ensayo\n---\n\nCuerpo del ensayo.\n');
  escribirEnProyecto('antologia.md', '---\ntitle: Antología\ntype: collection\nfiles:\n  - ./ensayo.md\n---\n\nIntro.\n');
  escribirEnProyecto('otra.md', '---\ntitle: Otra antología\ntype: collection\nfiles:\n  - ./ensayo.md\n---\n\nIntro.\n');
});

Given('un proyecto con un texto en una lista', () => {
  escribirEnProyecto('iteraciones.config.yaml', CONFIG_HTML);
  escribirEnProyecto('ensayo.md', '---\ntitle: Ensayo\n---\n\nCuerpo del ensayo.\n');
  escribirEnProyecto('seleccion.md', '---\ntitle: Selección\ntype: list\n---\n\nElegidos.\n');
});

function chipDelHtml(archivo: string, etiqueta: string): string {
  const html = leer(`dist/files/${archivo}`);
  const chips = [...html.matchAll(/<h2[^>]*>[\s\S]*?<\/h2>/g)].map((m) => m[0]);
  const chip = chips.find((bloque) => bloque.includes(etiqueta));
  if (chip === undefined) throw new Error(`el HTML de ${archivo} no tiene un chip ${JSON.stringify(etiqueta)}`);
  return chip;
}

Then('el chip {string} del HTML de {string} no es un enlace', (etiqueta: string, archivo: string) => {
  if (chipDelHtml(archivo, etiqueta).includes('<a ')) {
    throw new Error(`el chip ${JSON.stringify(etiqueta)} de ${archivo} es un enlace y no debería`);
  }
});

Then('el chip {string} del HTML de {string} enlaza a {string}', (etiqueta: string, archivo: string, href: string) => {
  const chip = chipDelHtml(archivo, etiqueta);
  if (!chip.includes(`href="${href}"`)) throw new Error(`el chip ${JSON.stringify(etiqueta)} de ${archivo} no enlaza a ${href}`);
});

Then('en el HTML de {string} el chip {string} enlaza a {string}', (archivo: string, etiqueta: string, href: string) => {
  const html = leer(`dist/files/${archivo}`);
  const enlace = new RegExp(`<a href="${escaparRegex(href)}" class="[^"]*bg-transparent[^"]*">${escaparRegex(etiqueta)}</a>`);
  if (!enlace.test(html)) throw new Error(`el chip ${JSON.stringify(etiqueta)} no enlaza a ${href} en ${archivo}`);
});

Then('en el HTML de {string} el chip {string} no es un enlace', (archivo: string, etiqueta: string) => {
  const html = leer(`dist/files/${archivo}`);
  const chip = new RegExp(`<span class="[^"]*bg-transparent[^"]*">${escaparRegex(etiqueta)}</span>`);
  if (!chip.test(html)) throw new Error(`el chip ${JSON.stringify(etiqueta)} no aparece sin enlace en ${archivo}`);
  if (new RegExp(`<a [^>]*>${escaparRegex(etiqueta)}</a>`).test(html)) {
    throw new Error(`el chip ${JSON.stringify(etiqueta)} es un enlace y no debería`);
  }
});

Then('el HTML de {string} no tiene chips de pertenencia', (archivo: string) => {
  const html = leer(`dist/files/${archivo}`);
  if (html.includes('bg-transparent')) throw new Error(`${archivo} tiene chips de pertenencia y no debería`);
});

Then('los enlaces de Formatos abren en otra pestaña', () => {
  const html = leer('dist/files/test-document.html');
  const enlaces = [...html.matchAll(/<a\b[^>]*>(PDF|EPUB|LaTeX|Markdown)<\/a>/g)];
  if (enlaces.length === 0) throw new Error('la tarjeta de Formatos no tiene enlaces');
  for (const [etiqueta, enlace] of enlaces.map((m) => [m[1], m[0]] as const)) {
    if (!(enlace ?? '').includes('target="_blank"')) throw new Error(`el enlace ${String(etiqueta)} no abre en otra pestaña`);
  }
});

Then('la tarjeta de identidad no es un enlace', () => {
  const html = leer('dist/files/test-document.html');
  if (!html.includes('id="card-identity" class="break-inside-avoid pb-6"><div class="relative')) {
    throw new Error('la tarjeta de identidad sigue siendo un enlace');
  }
});

Then('el logo y el nombre enlazan al inicio', () => {
  const html = leer('dist/files/test-document.html');
  const inicio = html.indexOf('id="card-identity"');
  const fin = html.indexOf('id="card-identity-footer"');
  const tarjeta = html.slice(inicio, fin);
  const enlaces = [...tarjeta.matchAll(/<a href="\.\/index\.html"/g)].length;
  if (enlaces !== 2) throw new Error(`la tarjeta de identidad tiene ${enlaces} enlaces al inicio y deberían ser 2`);
});

Then('la descripción no es un enlace', () => {
  const html = leer('dist/files/test-document.html');
  if (!html.includes('>escribir, compartir, re-existir</span>')) {
    throw new Error('la descripción no está en un span (parece un enlace)');
  }
});

Given('una colección con 25 textos', () => {
  const files = Array.from({ length: 25 }, (_, i) => `texto-${i + 1}.md`);
  escribirEnProyecto('antologia.md', `---\ntitle: Antología\ntype: collection\nfiles:\n${files.map((f) => `  - ${f}`).join('\n')}\n---\n\nIntro.\n`);
  for (const [i, file] of files.entries()) {
    escribirEnProyecto(file, `---\ntitle: Texto ${i + 1}\ndate: 2026-01-${String(i + 1).padStart(2, '0')}\n---\n\nCuerpo.\n`);
  }
});

Given('el proyecto tiene toc activo', () => {
  escribirEnProyecto('iteraciones.config.yaml', ['language: es-MX', 'toc: true', ...CONFIG_BASE.slice(1)].join('\n') + '\n');
});

function indiceDe(pagina: string, numero: number): string {
  const html = leer(pagina);
  const inicio = html.indexOf(`id="indice-pagina-${numero}"`);
  if (inicio < 0) throw new Error(`${pagina} no tiene el índice de la página ${numero}`);
  return html.slice(inicio, html.indexOf('</nav>', inicio));
}

Then('el índice de la página {int} de la colección lista {int} textos', (pagina: number, cuantos: number) => {
  const html = pagina === 1 ? 'dist/files/antologia.html' : `dist/files/antologia-${pagina}.html`;
  const indice = indiceDe(html, pagina);
  const items = [...indice.matchAll(/<li><a /g)].length;
  if (items !== cuantos) throw new Error(`el índice de la página ${pagina} lista ${items} textos y deberían ser ${cuantos}`);
});

Then('el índice de la página {int} enlaza el índice de la página {int}', (desde: number, hacia: number) => {
  const html = desde === 1 ? 'dist/files/antologia.html' : `dist/files/antologia-${desde}.html`;
  const indice = indiceDe(html, desde);
  const href = hacia === 1 ? 'antologia.html#indice-pagina-1' : `antologia-${hacia}.html#indice-pagina-${hacia}`;
  if (!indice.includes(href)) throw new Error(`el índice de la página ${desde} no enlaza ${href}`);
});
