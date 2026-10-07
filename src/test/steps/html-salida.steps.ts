import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Given, Then } from '@cucumber/cucumber';
import { initTestProject } from '../helpers.js';
import { escribirEnProyecto, tempRoot, world } from './cli-world.steps.ts';

function salida(relativa: string): string {
  const ruta = join(world.root, 'dist', 'files', relativa);
  if (!existsSync(ruta)) {
    throw new Error(`el build no dejó ${relativa} en dist/files`);
  }
  return readFileSync(ruta, 'utf8');
}

function exige(html: string, archivo: string, textos: string[]): void {
  for (const texto of textos) {
    if (!html.includes(texto)) {
      throw new Error(`${archivo} no dice ${JSON.stringify(texto)}`);
    }
  }
}

function prohibe(html: string, archivo: string, textos: string[]): void {
  for (const texto of textos) {
    if (html.includes(texto)) {
      throw new Error(`${archivo} sí dice ${JSON.stringify(texto)} y no debería`);
    }
  }
}

function cuenta(html: string, archivo: string, texto: string, veces: number): void {
  const contadas = html.split(texto).length - 1;
  if (contadas !== veces) {
    throw new Error(`${archivo} tiene ${contadas} apariciones de ${JSON.stringify(texto)} y son ${veces}`);
  }
}

function enOrden(html: string, archivo: string, cadena: string): void {
  let anterior = -1;
  for (const texto of cadena.split(',').map((t) => t.trim())) {
    const donde = html.indexOf(texto, anterior + 1);
    if (donde < 0) {
      throw new Error(`${archivo} no tiene ${JSON.stringify(texto)} después de lo anterior`);
    }
    anterior = donde;
  }
}

function raizVacia(): void {
  world.root = tempRoot('iteraciones-cli-');
  initTestProject(world.root);
}

const CITA = '@book{key1, author = {García, Lucía}, title = {Libro}, year = {2024}}\n';
const FRONTMATTER = '---\ntitle: Test Document\ndate: 2026-01-01\n---\n\n';

function proyectoConCita(indice: boolean): void {
  if (indice) {
    escribirEnProyecto('iteraciones.config.yaml', 'language: es-MX\ntoc: true\nformat:\n  latex:\n    generate: true\n');
  }
  escribirEnProyecto('bibliography.bib', CITA);
  escribirEnProyecto('test.md', `${FRONTMATTER}# Sección\n\nCita [@key1].\n`);
}

Given('que la raíz del proyecto tiene un proyecto con índice y una cita', () => {
  raizVacia();
  proyectoConCita(true);
});

Given('que la raíz del proyecto tiene un proyecto con una cita', () => {
  raizVacia();
  proyectoConCita(false);
});

Given('que la raíz del proyecto ordena los bloques así:', (bloques: string) => {
  const lista = bloques
    .split('\n')
    .map((b) => b.trim())
    .filter(Boolean)
    .map((b) => `      - ${b}`)
    .join('\n');
  raizVacia();
  escribirEnProyecto(
    'iteraciones.config.yaml',
    `language: es-MX\ntoc: true\nformat:\n  latex:\n    generate: true\n  html:\n    blocks:\n${lista}\n`,
  );
  escribirEnProyecto('test.md', `${FRONTMATTER}# Sección\n\nContenido.\n`);
});

Given('que la raíz del proyecto tiene el tema {word}', (tema: string) => {
  raizVacia();
  escribirEnProyecto(
    'iteraciones.config.yaml',
    `language: es-MX\nformat:\n  html:\n    generate: true\n    site:\n      title: T\n      theme: ${tema}\n`,
  );
  escribirEnProyecto('test.md', `${FRONTMATTER}# Sección\n\nContenido.\n`);
});

Given('que la raíz del proyecto tiene un documento de cada tipo', () => {
  raizVacia();
  escribirEnProyecto('autora.md', '---\ntype: creator\nname: Autora\n---\n\nBio.\n');
  escribirEnProyecto('coleccion.md', '---\ntitle: Antología\ntype: collection\nfiles:\n  - test.md\n---\n\nIntro.\n');
});

Given('que la raíz del proyecto tiene una colección con portada en markdown', () => {
  raizVacia();
  escribirEnProyecto(
    'coleccion.md',
    "---\ntitle: Antología\ntype: collection\ncollectionCreatorPrefix: '*Edición*'\nsubject: '**Ensayo** y `código`'\nfiles:\n  - test.md\n---\n\nIntro.\n",
  );
});

Given('que la raíz del proyecto tiene un documento con un título inhomogéneo', () => {
  raizVacia();
  escribirEnProyecto('test.md', '---\ntitle: "Título: \\"especial\\" y más\\ncon salto"\ndate: 2026-01-01\n---\n\nContenido.\n');
});

Given('que la raíz del proyecto desactiva el HTML y enciende LaTeX', () => {
  escribirEnProyecto('iteraciones.config.yaml', 'language: es-MX\nformat:\n  html:\n    generate: false\n  latex:\n    generate: true\n');
});

Given('que escribo markdown de relleno con clases inventadas', () => {
  for (const [relativa, clase] of [
    ['dist/files/basura.md', 'bg-fuchsia-700'],
    ['.iteraciones/changes/basura.md', 'bg-indigo-700'],
  ] as const) {
    const ruta = join(world.root, relativa);
    mkdirSync(dirname(ruta), { recursive: true });
    writeFileSync(ruta, `${clase}\n`, 'utf8');
  }
});

Given('que el documento tiene una clase que hay que compilar', () => {
  escribirEnProyecto('test.md', `${FRONTMATTER}<div class="bg-teal-300">x</div>\n\nNuevo contenido.\n`);
});

Then('las tarjetas del documento salen en el orden por defecto', () => {
  const archivo = 'test-document.html';
  enOrden(salida(archivo), archivo, 'id="card-identity", id="TOC", >Descarga</h2>, <article, id="refs-heading", id="card-identity-footer"');
});

Then('la lista explícita de bloques ES el orden', () => {
  const archivo = 'test-document.html';
  enOrden(salida(archivo), archivo, 'id="card-identity", <article, id="TOC", >Descarga</h2>');
});

Then('los bloques que no aplican no dejan huecos', () => {
  const archivo = 'test-document.html';
  const html = salida(archivo);

  enOrden(html, archivo, 'id="card-identity", <article, id="card-identity-footer"');
  prohibe(html, archivo, ['>Descarga</h2>', 'id="TOC"', 'refs-heading']);
});

Then('las tarjetas de formatos y referencias quedan fuera de la de contenido', () => {
  const archivo = 'test-document.html';
  const html = salida(archivo);
  const html1 = html.indexOf('>Descarga</h2>');
  const article = html.indexOf('<article');
  const refs = html.indexOf('id="refs-heading"');
  const cierre = html.indexOf('</article>');
  if (html1 < 0 || article < 0 || refs < 0 || cierre < 0) {
    throw new Error(`faltan tarjetas en ${archivo}`);
  }

  if (!(html1 < article)) throw new Error('la tarjeta de formatos quedó dentro del article');
  if (!(refs > cierre)) throw new Error('la tarjeta de referencias quedó dentro del article');
});

Then('un heading Referencias propio sobrevive cuando no hay citas', () => {
  const archivo = 'test-document.html';
  const html = salida(archivo);
  exige(html, archivo, ['<h5 id="referencias">Referencias</h5>', 'Manual.']);

  prohibe(html, archivo, ['refs-heading']);
});

Then('el heading propio y la tarjeta de referencias no se pisan', () => {
  const archivo = 'test-document.html';
  const html = salida(archivo);
  exige(html, archivo, ['<h5 id="referencias">Referencias</h5>', 'id="refs-heading"', 'csl-entry']);

  cuenta(html, archivo, 'id="referencias"', 1);
});

Then('el heading de la tarjeta va antes que sus entradas', () => {
  enOrden(salida('test-document.html'), 'test-document.html', 'id="refs-heading", <div id="refs"');
});

Then('una cita sin entrada deja el documento sin tarjeta de referencias', () => {
  const archivo = 'test-document.html';
  const html = salida(archivo);

  prohibe(html, archivo, ['<h1 id="refs-heading">', 'id="block-referencias"']);
  exige(html, archivo, ['<h5 id="sección">Sección</h5>']);
});

Then('el índice no ofrece referencias pero la tarjeta las conserva', () => {
  const archivo = 'test-document.html';
  const html = salida(archivo);

  const ancla = html.indexOf('id="TOC"');
  if (ancla < 0) throw new Error(`${archivo} no tiene nav#TOC`);
  const inicio = html.lastIndexOf('<nav', ancla);
  const indice = html.slice(inicio, html.indexOf('</nav>', inicio));
  if (indice.includes('refs-heading')) {
    throw new Error('el índice enlaza a la tarjeta de referencias y no debería');
  }
  exige(html, archivo, ['id="refs-heading"', '>Referencias</h2>', 'csl-entry', 'href="#ref-key1"']);
});

Then('el chip de la banda nombra el type de cada documento', () => {
  for (const [archivo, chip] of [
    ['test-document.html', 'Texto'],
    ['antologia.html', 'Colección'],
    ['autora.html', 'Creadora'],
  ] as const) {
    if (!new RegExp(`>\\s*${chip}\\s*</h2>`).test(salida(archivo))) {
      throw new Error(`${archivo} no tiene el chip ${JSON.stringify(chip)}`);
    }
  }
  prohibe(salida('test-document.html'), 'test-document.html', ['>Contenido</h2>']);
});

Then('los campos de portada salen renderizados como markdown', () => {
  const archivo = 'antologia.html';
  const html = salida(archivo);

  exige(html, archivo, ['<em>Edición</em>', '<strong>Ensayo</strong> y <code>código</code>']);
  prohibe(html, archivo, ['*Edición*', '**Ensayo**']);
});

Then('un título inhomogéneo no rompe el HTML', () => {
  const archivo = 'titulo-especial-y-mas-con-salto.html';
  const html = salida(archivo);
  exige(html, archivo, ['<title>Título: "especial" y más con salto · Test</title>', '"especial"', 'con salto']);
});

Then('el HTML de dist lleva el data-theme {string}', (tema: string) => {
  const archivo = 'test-document.html';
  exige(salida(archivo), archivo, [`data-theme="${tema}"`]);
});

Then('el CSS se compila sobre los HTML finales', () => {
  const css = salida(join('assets', 'css', 'styles.css'));

  exige(css, 'styles.css', ['prose-xl', 'oklch(76.8% .233 130.85)', 'bg-teal-300']);

  prohibe(css, 'styles.css', ['bg-fuchsia-700', 'bg-indigo-700']);
});

Then('la página trae el botón de volver al principio y el CSS su animación', () => {
  const archivo = 'test-document.html';
  const html = salida(archivo);
  exige(html, archivo, [
    '<body id="top"',
    'aria-label="Volver al principio"',
    'scroll-reveal',

    '<main class="container mx-auto columns-1 lg:columns-2 2xl:columns-3 gap-6 px-4 sm:px-6 lg:px-8 pt-8 pb-24">',
  ]);

  prohibe(html, archivo, ['block:volver']);
  exige(salida(join('assets', 'css', 'styles.css')), 'styles.css', ['@keyframes scroll-reveal', 'animation-timeline:scroll()']);
});

Then('sin HTML activo no se copian las fuentes', () => {
  const ruta = join(world.root, 'dist', 'files', 'fonts');
  if (existsSync(ruta)) {
    throw new Error('la salida tiene fonts y no debería: son assets de HTML');
  }
});
