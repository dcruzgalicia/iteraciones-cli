import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Given, Then } from '@cucumber/cucumber';
import { initTestProject } from '../helpers.js';
import { escribirEnProyecto, tempRoot, world } from './cli-world.steps.ts';

/**
 * #2580 (onda 2) — el HTML y el CSS que deja un build.
 *
 * Quince `it()` de `cli-layer` leían `dist/files/*.html` y comparaban cadenas.
 * Todos hacen lo mismo —leer un archivo de la salida y mirarlo— así que el
 * acceso va aquí y no en cada feature.
 *
 * ## Un `Then` por regla de negocio, no por aserción
 *
 * El primer borrador de estos features usaba un paso genérico por aserción
 * (`el HTML de "x.html" dice ...`) y `check-steps` lo rechazó con 4.8 pasos por
 * escenario. El motivo del techo es éste: un `Then` que repite el nombre del
 * archivo quince veces no dice qué regla se está comprobando, y cuando la
 * regla cambia hay que editar quince pasos en lugar de uno.
 *
 * Por eso los pasos de aquí llevan el nombre de la REGLA —`las tarjetas del
 * documento salen en el orden por defecto`, `una cita sin entrada deja el
 * documento sin tarjeta`— y llevan dentro todas sus aserciones. La excepción
 * es `ordena`, que sí es genérico: cuatro escenarios distintos comprueban
 * cadenas de orden distintas y un paso por cada una sería peor.
 */

/** Lee un archivo de `dist/files`, o falla diciendo qué se esperaba encontrar. */
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

/** Exige que `cadena` aparezca en ese orden dentro de `html`. */
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

/** El mismo proyecto de referencia de `initTestProject`, con su raíz nueva. */
function raizVacia(): void {
  world.root = tempRoot('iteraciones-cli-');
  initTestProject(world.root);
}

const CITA = '@book{key1, author = {García, Lucía}, title = {Libro}, year = {2024}}\n';
const FRONTMATTER = '---\ntitle: Test Document\ndate: 2026-01-01\n---\n\n';

/**
 * El proyecto que casi todos estos escenarios necesitan: índice, LaTeX, una
 * cita real y una sección. Sin la cita en el `.bib`, citeproc no genera
 * `div#refs` y los escenarios de referencias no prueban nada.
 */
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

/** `format.html.blocks` con la lista de bloques en el orden que se le pase. */
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

/** `format.html.site.theme`: el `data-theme` del esqueleto. */
Given('que la raíz del proyecto tiene el tema {word}', (tema: string) => {
  raizVacia();
  escribirEnProyecto(
    'iteraciones.config.yaml',
    `language: es-MX\nformat:\n  html:\n    generate: true\n    site:\n      title: T\n      theme: ${tema}\n`,
  );
  escribirEnProyecto('test.md', `${FRONTMATTER}# Sección\n\nContenido.\n`);
});

/** Los tres documentos con los tres `type` que existen. */
Given('que la raíz del proyecto tiene un documento de cada tipo', () => {
  raizVacia();
  escribirEnProyecto('autora.md', '---\ntype: creator\nname: Autora\n---\n\nBio.\n');
  escribirEnProyecto('coleccion.md', '---\ntitle: Antología\ntype: collection\nfiles:\n  - test.md\n---\n\nIntro.\n');
});

/** Una colección cuyos campos de portada están escritos en markdown. */
Given('que la raíz del proyecto tiene una colección con portada en markdown', () => {
  raizVacia();
  escribirEnProyecto(
    'coleccion.md',
    "---\ntitle: Antología\ntype: collection\ncollectionCreatorPrefix: '*Edición*'\nsubject: '**Ensayo** y `código`'\nfiles:\n  - test.md\n---\n\nIntro.\n",
  );
});

/**
 * El YAML de doble comilla interpreta `\n` como salto de línea real en el
 * valor, así que el título lleva comillas, dos puntos y un salto. El slug sale
 * de ahí, y por eso el archivo se llama `titulo-especial-y-mas-con-salto`.
 */
Given('que la raíz del proyecto tiene un documento con un título inhomogéneo', () => {
  raizVacia();
  escribirEnProyecto('test.md', '---\ntitle: "Título: \\"especial\\" y más\\ncon salto"\ndate: 2026-01-01\n---\n\nContenido.\n');
});

/** Sin HTML no hay assets de HTML: ni fuentes ni sus licencias. */
Given('que la raíz del proyecto desactiva el HTML y enciende LaTeX', () => {
  escribirEnProyecto('iteraciones.config.yaml', 'language: es-MX\nformat:\n  html:\n    generate: false\n  latex:\n    generate: true\n');
});

/**
 * Markdown suelto dentro de `dist/` y de `.iteraciones/`. El escaneo que
 * decide qué clases se compilan sólo debe leer los HTML FINALES de
 * `dist/files`: si leyera cualquier `.md`, estas clases inventadas acabarían
 * en el CSS de producción.
 */
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

/** Reemplaza el documento del proyecto por uno con HTML dentro del markdown. */
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
  // El artículo sí queda entre el header y el footer: lo que no hay son huecos.
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
  // El article es el CONTENIDO. Las otras tarjetas van antes o después de él,
  // nunca dentro: dentro, las columnas del masonry las reparten con el texto
  // y el documento deja de leerse como un bloque (#1445).
  if (!(html1 < article)) throw new Error('la tarjeta de formatos quedó dentro del article');
  if (!(refs > cierre)) throw new Error('la tarjeta de referencias quedó dentro del article');
});

Then('un heading Referencias propio sobrevive cuando no hay citas', () => {
  const archivo = 'test-document.html';
  const html = salida(archivo);
  exige(html, archivo, ['<h5 id="referencias">Referencias</h5>', 'Manual.']);
  // Sin citas no hay heading sintético: el del autor es el único.
  prohibe(html, archivo, ['refs-heading']);
});

Then('el heading propio y la tarjeta de referencias no se pisan', () => {
  const archivo = 'test-document.html';
  const html = salida(archivo);
  exige(html, archivo, ['<h5 id="referencias">Referencias</h5>', 'id="refs-heading"', 'csl-entry']);
  // El id del autor en el body y el de la tarjeta: si el sintético hubiera
  // usado `referencias`, la página tendría dos elementos con el mismo id y el
  // ancla del índice saltaría al primero.
  cuenta(html, archivo, 'id="referencias"', 1);
});

Then('el heading de la tarjeta va antes que sus entradas', () => {
  // Si `--citeproc` se moviera antes de los `--lua-filter`, citeproc insertaría
  // `div#refs` DESPUÉS del heading sintético y el extractor no lo encontraría.
  // Este orden es parte del contrato del argv, no un detalle del post-proceso.
  enOrden(salida('test-document.html'), 'test-document.html', 'id="refs-heading", <div id="refs"');
});

Then('una cita sin entrada deja el documento sin tarjeta de referencias', () => {
  const archivo = 'test-document.html';
  const html = salida(archivo);
  // Una tarjeta sin contenido es un hueco visible: se va el heading entero, no
  // sólo el bloque de entradas.
  prohibe(html, archivo, ['<h1 id="refs-heading">', 'id="block-referencias"']);
  exige(html, archivo, ['<h5 id="sección">Sección</h5>']);
});

Then('el índice no ofrece referencias pero la tarjeta las conserva', () => {
  const archivo = 'test-document.html';
  const html = salida(archivo);
  // El índice lista SECCIONES del documento. Enlazar a la bibliografía mete una
  // entrada que no es una sección, y el índice deja de corresponder con la
  // página.
  // El `<nav>` sale partido en varias líneas por el formateo del template, así
  // que no se puede buscar la etiqueta entera: se ancla en el `id` y se
  // retrocede hasta el `<nav` que lo abre.
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
  // El chip ES el `type` con su nombre en castellano. No hay un chip genérico:
  // un "Contenido" no le dice al autor qué está leyendo.
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
  // Igual que en la portada del PDF: si salieran en crudo, el asterisco y la
  // comilla se verían en la página y el autor pensaría que escribió mal.
  exige(html, archivo, ['<em>Edición</em>', '<strong>Ensayo</strong> y <code>código</code>']);
  prohibe(html, archivo, ['*Edición*', '**Ensayo**']);
});

Then('un título inhomogéneo no rompe el HTML', () => {
  const archivo = 'titulo-especial-y-mas-con-salto.html';
  const html = salida(archivo);
  exige(html, archivo, ['<title>Título: "especial" y más con salto · Test</title>', '"especial"', 'con salto']);
});

/** `format.html.site.theme` viaja como metadata a pandoc y sale en el `data-theme`. */
Then('el HTML de dist lleva el data-theme {string}', (tema: string) => {
  const archivo = 'test-document.html';
  exige(salida(archivo), archivo, [`data-theme="${tema}"`]);
});

Then('el CSS se compila sobre los HTML finales', () => {
  const css = salida(join('assets', 'css', 'styles.css'));
  // `prose-xl` viene del template; el acento por defecto (lime-500) se compila
  // directo; `bg-teal-300` viene del HTML escrito dentro del markdown.
  exige(css, 'styles.css', ['prose-xl', 'oklch(76.8% .233 130.85)', 'bg-teal-300']);
  // Y lo que nadie usa se queda fuera: ni el markdown suelto en `dist/` ni el
  // de `.iteraciones/changes`.
  prohibe(css, 'styles.css', ['bg-fuchsia-700', 'bg-indigo-700']);
});

Then('la página trae el botón de volver al principio y el CSS su animación', () => {
  const archivo = 'test-document.html';
  const html = salida(archivo);
  exige(html, archivo, [
    '<body id="top"',
    'aria-label="Volver al principio"',
    'scroll-reveal',
    // El `main` es el que reparte en columnas y el que deja libre el aire de
    // abajo (`pb-24`) para que el botón flotante no tape el texto.
    '<main class="container mx-auto columns-1 lg:columns-2 2xl:columns-3 gap-6 px-4 sm:px-6 lg:px-8 pt-8 pb-24">',
  ]);
  // El botón no es un bloque del masonry: vive fuera del sistema de bloques.
  prohibe(html, archivo, ['block:volver']);
  exige(salida(join('assets', 'css', 'styles.css')), 'styles.css', ['@keyframes scroll-reveal', 'animation-timeline:scroll()']);
});

Then('sin HTML activo no se copian las fuentes', () => {
  const ruta = join(world.root, 'dist', 'files', 'fonts');
  if (existsSync(ruta)) {
    throw new Error('la salida tiene fonts y no debería: son assets de HTML');
  }
});
