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
  const yaml = [...CONFIG_BASE, '    site:', '      title: Test', '      links:', ...enlaces].join('\n');
  escribirEnProyecto('iteraciones.config.yaml', `${yaml}\n`);
});

Then('las redes aparecen una vez en el header y otra en el footer', () => {
  const html = leer('dist/files/test-document.html');
  const header = html.indexOf('<header');
  const footer = html.indexOf('<footer');
  const frecuencias = [...html.matchAll(/aria-label="Redes"/g)].map((m) => m.index ?? -1);
  if (frecuencias.length !== 2) throw new Error(`hay ${frecuencias.length} bloques de redes y deberían ser 2`);
  const [primera, segunda] = frecuencias as [number, number];
  if (!(header < primera && primera < footer)) throw new Error('la primera redes no va dentro del header');
  if (!(segunda > footer)) throw new Error('la segunda redes no va dentro del footer');
});

Given('un proyecto con una creadora con redes', () => {
  escribirEnProyecto(
    'iteraciones.config.yaml',
    `${CONFIG_HTML}    site:\n      title: Histórikas\n      links:\n        - name: Facebook\n          url: https://facebook.com/h\n`,
  );
  escribirEnProyecto(
    'ana.md',
    '---\nname: Ana Ruiz\ntype: creator\nlinks:\n  - name: Instagram\n    url: https://instagram.com/ana\n  - name: Blog\n    url: https://ana.example\n---\n\nBio de Ana.\n',
  );
  escribirEnProyecto('sin-redes.md', '---\nname: Sin Redes\ntype: creator\n---\n\nBio sin enlaces.\n');
});

Then('el HTML de {string} tiene la tarjeta de redes de {string}', (archivo: string, dueno: string) => {
  const html = leer(`dist/files/${archivo}`);
  const tarjeta = new RegExp(`<h2[^>]*>Redes</h2><span class="[^"]*bg-transparent[^"]*">${RegExp.escape(dueno)}</span>`);
  if (!tarjeta.test(html)) throw new Error(`${archivo} no tiene la tarjeta de redes de ${dueno}`);
});

Then('los enlaces de la tarjeta de redes de {string} abren en otra pestaña', (archivo: string) => {
  const html = leer(`dist/files/${archivo}`);
  const tarjeta = /<h2[^>]*>Redes<\/h2><span class="[^"]*bg-transparent[^"]*">[^<]*<\/span>[\s\S]*?<\/ul>/.exec(html)?.[0] ?? '';
  if (tarjeta === '') throw new Error(`${archivo} no tiene la tarjeta de redes`);
  const enlaces = [...tarjeta.matchAll(/<a\b[^>]*>/g)].map((m) => m[0]);
  if (enlaces.length === 0) throw new Error(`la tarjeta de redes de ${archivo} no tiene enlaces`);
  for (const enlace of enlaces) {
    if (!enlace.includes('target="_blank"')) throw new Error(`un enlace de redes de ${archivo} no abre en otra pestaña: ${enlace}`);
  }
});

Then('el cuerpo de {string} no lleva las redes en negritas', (archivo: string) => {
  const html = leer(`dist/files/${archivo}`);
  if (html.includes('<strong>Instagram</strong>') || html.includes('<strong>Facebook</strong>')) {
    throw new Error(`${archivo} todavía lleva las redes en negritas dentro del cuerpo`);
  }
});

Then('el HTML de {string} sólo tiene las redes del sitio', (archivo: string) => {
  const html = leer(`dist/files/${archivo}`);
  const tarjetas = html.match(/aria-label="Redes"/g) ?? [];
  if (tarjetas.length !== 2) throw new Error(`${archivo} tiene ${tarjetas.length} bloques de redes y deberían ser 2 (los del sitio)`);
});

Given('el proyecto produce html y markdown', () => {
  escribirEnProyecto('iteraciones.config.yaml', 'language: es-MX\nformat:\n  html:\n    generate: true\n  markdown:\n    generate: true\n');
});

const CONFIG_HTML = 'language: es-MX\nformat:\n  html:\n    generate: true\n';

Given('un proyecto con un texto en dos colecciones', () => {
  escribirEnProyecto('iteraciones.config.yaml', CONFIG_HTML);
  escribirEnProyecto('ensayo.md', '---\ntitle: Ensayo\n---\n\nCuerpo del ensayo.\n');
  escribirEnProyecto('antologia.md', '---\ntitle: Antología\ntype: collection\nfiles:\n  - ./ensayo.md\n---\n\nIntro.\n');
  escribirEnProyecto('otra.md', '---\ntitle: Otra antología\ntype: collection\nfiles:\n  - ./ensayo.md\n---\n\nIntro.\n');
});

function proyectoConKeywords(config: string): void {
  escribirEnProyecto('iteraciones.config.yaml', config);
  escribirEnProyecto('ensayo.md', '---\ntitle: Ensayo\nkeywords:\n  - cuidados\n  - mujeres\n---\n\nCuerpo del ensayo.\n');
  escribirEnProyecto('otro.md', '---\ntitle: Otro\nkeywords:\n  - cuidados\n---\n\nOtro cuerpo.\n');
}

Given('un proyecto con un &nbsp; en el texto', () => {
  escribirEnProyecto('iteraciones.config.yaml', 'language: es-MX\nformat:\n  html:\n    generate: true\n  markdown:\n    generate: true\n');
  escribirEnProyecto('ensayo.md', '---\ntitle: Ensayo\n---\n\nUn texto&nbsp;unido y otro\u00a0pegado.\n');
});

Given('un proyecto con textos que comparten keywords', () => {
  proyectoConKeywords(CONFIG_HTML);
});

Given('un proyecto con textos y keywords en html y epub', () => {
  proyectoConKeywords('language: es-MX\nformat:\n  html:\n    generate: true\n  epub:\n    generate: true\n');
});

Then('el HTML de {string} contiene {string}', (archivo: string, texto: string) => {
  const html = leer(`dist/files/${archivo}`);
  if (!html.includes(texto)) throw new Error(`el HTML de ${archivo} no contiene ${JSON.stringify(texto)}`);
});

Given('un proyecto con un texto en una lista', () => {
  escribirEnProyecto('iteraciones.config.yaml', CONFIG_HTML);
  escribirEnProyecto('ensayo.md', '---\ntitle: Ensayo\n---\n\nCuerpo del ensayo.\n');
  escribirEnProyecto('seleccion.md', '---\ntitle: Selección\ntype: list\n---\n\nElegidos.\n');
});

function chipDelHtml(archivo: string, etiqueta: string): string {
  const html = leer(`dist/files/${archivo}`);
  const patron = new RegExp(`<(h2|a|span)\\b[^>]*class="[^"]*rounded-full[^"]*"[^>]*>(?:<a\\b[^>]*>)?${RegExp.escape(etiqueta)}(?:</a>)?</\\1>`);
  const chip = patron.exec(html);
  if (chip !== null) return chip[0];
  const enlace = new RegExp(`<a\\b[^>]*class="[^"]*text-accent-700[^"]*"[^>]*>${RegExp.escape(etiqueta)}</a>`).exec(html);
  if (enlace !== null) return enlace[0];
  const texto = new RegExp(`<span[^>]*>${RegExp.escape(etiqueta)}</span>`).exec(html);
  if (texto !== null) return texto[0];
  throw new Error(`el HTML de ${archivo} no tiene un chip ${JSON.stringify(etiqueta)}`);
}

Then('el chip {string} del HTML de {string} no es un enlace', (etiqueta: string, archivo: string) => {
  const chip = chipDelHtml(archivo, etiqueta);
  if (chip.startsWith('<a') || chip.includes('<a ')) {
    throw new Error(`el chip ${JSON.stringify(etiqueta)} de ${archivo} es un enlace y no debería`);
  }
});

Then('el EPUB {string} no contiene {string}', async (archivo: string, texto: string) => {
  const epub = join(world.root, 'dist', 'files', `${archivo}.epub`);
  const proc = Bun.spawn(['unzip', '-p', epub], { stdout: 'pipe', stderr: 'pipe' });
  const [salida, errores, codigo] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  if (codigo !== 0) throw new Error(`unzip falló con ${archivo}.epub: ${errores}`);
  if (salida.includes(texto)) throw new Error(`el EPUB ${archivo} contiene ${JSON.stringify(texto)} y no debería`);
});

Then('el EPUB {string} declara la clave {string} con el valor {string}', async (archivo: string, clave: string, valor: string) => {
  const epub = join(world.root, 'dist', 'files', `${archivo}.epub`);
  const proc = Bun.spawn(['unzip', '-p', epub, 'EPUB/content.opf'], { stdout: 'pipe', stderr: 'pipe' });
  const [salida, errores, codigo] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  if (codigo !== 0) throw new Error(`unzip falló con ${archivo}.epub: ${errores}`);
  if (!new RegExp(`<${clave}[^>]*>${RegExp.escape(valor)}</${clave}>`).test(salida)) {
    throw new Error(`el EPUB ${archivo} no declara ${clave}=${JSON.stringify(valor)}`);
  }
});

Then('el EPUB {string} contiene {string}', async (archivo: string, texto: string) => {
  const epub = join(world.root, 'dist', 'files', `${archivo}.epub`);
  const proc = Bun.spawn(['unzip', '-p', epub], { stdout: 'pipe', stderr: 'pipe' });
  const [salida, errores, codigo] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  if (codigo !== 0) throw new Error(`unzip falló con ${archivo}.epub: ${errores}`);
  if (!salida.includes(texto)) throw new Error(`el EPUB ${archivo} no contiene ${JSON.stringify(texto)}`);
});

Then('el chip {string} del HTML de {string} sólo se subraya al pasar el ratón', (etiqueta: string, archivo: string) => {
  const chip = chipDelHtml(archivo, etiqueta);
  if (!/class="[^"]*no-underline/.test(chip)) throw new Error(`el chip ${JSON.stringify(etiqueta)} de ${archivo} no lleva no-underline`);
  if (!/class="[^"]*hover:underline/.test(chip)) throw new Error(`el chip ${JSON.stringify(etiqueta)} de ${archivo} no se subraya en hover`);
  const clases = /class="([^"]*)"/.exec(chip)?.[1] ?? '';
  if (clases.split(/\s+/).includes('underline')) {
    throw new Error(`el chip ${JSON.stringify(etiqueta)} de ${archivo} está subrayado siempre`);
  }
});

Then('el chip {string} del HTML de {string} enlaza a {string}', (etiqueta: string, archivo: string, href: string) => {
  const chip = chipDelHtml(archivo, etiqueta);
  if (!chip.includes(`href="${href}"`)) throw new Error(`el chip ${JSON.stringify(etiqueta)} de ${archivo} no enlaza a ${href}`);
});

Then('en el HTML de {string} el chip {string} enlaza a {string}', (archivo: string, etiqueta: string, href: string) => {
  const html = leer(`dist/files/${archivo}`);
  const enlace = new RegExp(`<a href="${RegExp.escape(href)}"[^>]*>${RegExp.escape(etiqueta)}</a>`);
  if (!enlace.test(html)) throw new Error(`el chip ${JSON.stringify(etiqueta)} no enlaza a ${href} en ${archivo}`);
});

Then('en el HTML de {string} el chip {string} no es un enlace', (archivo: string, etiqueta: string) => {
  const html = leer(`dist/files/${archivo}`);
  const chip = new RegExp(`<span class="[^"]*bg-transparent[^"]*">${RegExp.escape(etiqueta)}</span>`);
  if (!chip.test(html)) throw new Error(`el chip ${JSON.stringify(etiqueta)} no aparece sin enlace en ${archivo}`);
  if (new RegExp(`<a [^>]*class="[^"]*rounded-full[^"]*"[^>]*>${RegExp.escape(etiqueta)}</a>`).test(html)) {
    throw new Error(`el chip ${JSON.stringify(etiqueta)} es un enlace y no debería`);
  }
});

Then('ningún enlace del HTML lleva {string} por defecto', (clase: string) => {
  const archivos = [...new Bun.Glob('dist/files/**/*.html').scanSync({ cwd: world.root })];
  const culpables: string[] = [];
  for (const archivo of archivos) {
    const html = readFileSync(join(world.root, archivo), 'utf8');
    for (const enlace of html.matchAll(/<a\b[^>]*class="([^"]*)"/g)) {
      if ((enlace[1] ?? '').split(/\s+/).includes(clase)) culpables.push(archivo);
    }
  }
  if (culpables.length > 0) throw new Error(`enlaces con ${clase} por defecto en: ${[...new Set(culpables)].join(', ')}`);
});

Then('los enlaces de Formatos abren en otra pestaña', () => {
  const html = leer('dist/files/test-document.html');
  const enlaces = [...html.matchAll(/<a\b[^>]*>(PDF|EPUB|LaTeX|Markdown)<\/a>/g)];
  if (enlaces.length === 0) throw new Error('la tarjeta de Formatos no tiene enlaces');
  for (const [etiqueta, enlace] of enlaces.map((m) => [m[1], m[0]] as const)) {
    if (!(enlace ?? '').includes('target="_blank"')) throw new Error(`el enlace ${String(etiqueta)} no abre en otra pestaña`);
  }
});

Then('la identidad no es un enlace', () => {
  const html = leer('dist/files/test-document.html');
  if (!html.includes('id="card-identity" class="min-w-0"><div class="flex flex-col items-center')) {
    throw new Error('la identidad sigue siendo un enlace');
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

Given('una colección con {int} textos', (cuantos: number) => {
  const files = Array.from({ length: cuantos }, (_, i) => `texto-${i + 1}.md`);
  escribirEnProyecto('antologia.md', `---\ntitle: Antología\ntype: collection\nfiles:\n${files.map((f) => `  - ${f}`).join('\n')}\n---\n\nIntro.\n`);
  for (const [i, file] of files.entries()) {
    escribirEnProyecto(file, `---\ntitle: Texto ${i + 1}\ndate: 2026-01-${String(i + 1).padStart(2, '0')}\n---\n\nCuerpo.\n`);
  }
});

Given('el proyecto tiene toc activo', () => {
  const yaml = ['language: es-MX', 'toc: true', ...CONFIG_BASE.slice(1)].join('\n');
  escribirEnProyecto('iteraciones.config.yaml', `${yaml}\n`);
});

function indiceDe(pagina: string): string {
  const html = leer(pagina);
  const inicio = html.indexOf('id="indice-completo"');
  if (inicio < 0) throw new Error(`${pagina} no tiene el índice completo`);
  return html.slice(inicio, html.indexOf('</nav>', inicio));
}

Then('el índice de la página {int} de la colección lista {int} textos', (pagina: number, cuantos: number) => {
  const html = pagina === 1 ? 'dist/files/antologia.html' : `dist/files/antologia-${pagina}.html`;
  const indice = indiceDe(html);
  const items = [...indice.matchAll(/<li><a /g)].length;
  if (items !== cuantos) throw new Error(`el índice de la página ${pagina} lista ${items} textos y deberían ser ${cuantos}`);
});

Then('el índice de la página {int} no dice {string}', (pagina: number, texto: string) => {
  const html = pagina === 1 ? 'dist/files/antologia.html' : `dist/files/antologia-${pagina}.html`;
  if (indiceDe(html).includes(texto)) throw new Error(`el índice de la página ${pagina} dice ${JSON.stringify(texto)} y no debería`);
});
