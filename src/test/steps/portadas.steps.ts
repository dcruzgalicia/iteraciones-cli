import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Before, Given, Then, When } from '@cucumber/cucumber';
import { build } from '../../builder/orchestrator.js';
import { capture, escribirEnProyecto, tempRoot, world } from './cli-world.steps.ts';

const CONFIG = ['language: es-MX', 'format:', '  latex:', '    generate: true', '  pdf:', '    generate: true'].join('\n');

const PORTADAS = [
  { campo: 'frontCover', color: 'red' },
  { campo: 'backCover', color: 'blue' },
  { campo: 'startpaper', color: 'green' },
] as const;

const TONOS: Record<string, number> = { red: 54, blue: 18, green: 92 };

Before(() => {
  world.root = tempRoot('iteraciones-portadas-');
});

function corre(bin: string, args: string[]): { salida: string; error: string; codigo: number } {
  const proc = Bun.spawnSync([bin, ...args]);
  return {
    salida: proc.stdout.toString(),
    error: proc.stderr.toString(),
    codigo: proc.exitCode,
  };
}

Given('el proyecto tiene un libro', () => {
  escribirEnProyecto('iteraciones.config.yaml', `${CONFIG}\n`);
  escribirEnProyecto('libro.md', '---\ntitle: Un libro\n---\n\nCuerpo del libro.\n');
});

Given('el libro lleva la portada {string}', (campo: string) => {
  const portada = PORTADAS.find((p) => p.campo === campo);
  if (portada === undefined) throw new Error(`no conozco la portada ${campo}`);
  const frontmatter = readFileSync(join(world.root, 'libro.md'), 'utf8').replace(
    '---\ntitle: Un libro\n',
    `---\ntitle: Un libro\n${portada.campo}: ./${portada.campo}.png\n`,
  );
  escribirEnProyecto('libro.md', frontmatter);
  const proc = Bun.spawnSync(['magick', '-size', '40x60', `xc:${portada.color}`, join(world.root, `${portada.campo}.png`)]);
  if (proc.exitCode !== 0) throw new Error('magick no pudo crear la portada de prueba');
});

Given('el libro lleva las guardas en color', () => {
  const config = readFileSync(join(world.root, 'iteraciones.config.yaml'), 'utf8');
  escribirEnProyecto('iteraciones.config.yaml', config.replace('  pdf:\n    generate: true', '  pdf:\n    generate: true\n    coverColor: true'));
});

Given('el libro lleva el epígrafe {string}', (texto: string) => {
  const frontmatter = readFileSync(join(world.root, 'libro.md'), 'utf8').replace(
    '---\ntitle: Un libro\n',
    `---\ntitle: Un libro\nextratitle: "${texto}"\n`,
  );
  escribirEnProyecto('libro.md', frontmatter);
});

When('compilo el proyecto del libro para leer su LaTeX', async () => {
  await capture(() => build(world.root, {}));
  world.tex = readFileSync(join(world.root, 'dist', 'files', 'un-libro.tex'), 'utf8');
});

Given('el proyecto compila el PDF', async () => {
  await capture(() => build(world.root, {}));
  world.pdf = join(world.root, 'dist', 'files', 'un-libro.pdf');
});

Then('el LaTeX del libro tiene {string}', (texto: string) => {
  if (!world.tex.includes(texto)) {
    throw new Error(`el .tex no tiene ${JSON.stringify(texto)}`);
  }
});

Then('el LaTeX del libro llama a {string}', (macro: string) => {
  // La llamada va sola en su línea; la definición y la llamada interna viven
  // dentro de \setstartpaper.
  const llamada = new RegExp(`^${macro.replace(/\\/g, '\\\\')}\\{`, 'm');
  if (!llamada.test(world.tex)) {
    throw new Error(`el .tex no llama a ${JSON.stringify(macro)}`);
  }
});

Then('el LaTeX del libro no llama a {string}', (macro: string) => {
  const llamada = new RegExp(`^${macro.replace(/\\/g, '\\\\')}\\{`, 'm');
  if (llamada.test(world.tex)) {
    throw new Error(`el .tex sí llama a ${JSON.stringify(macro)} y no debería`);
  }
});

Then('el LaTeX del libro llama a las guardas antes del título:', (esperado: string) => {
  const codigo = world.tex.slice(world.tex.indexOf('\\renewcommand{\\maketitle}'));
  if (!codigo.includes(esperado.replace(/\n$/, ''))) {
    throw new Error(`el maketitle no trae ${JSON.stringify(esperado)}`);
  }
});

Then('el PDF del libro tiene {int} páginas', (paginas: number) => {
  const info = corre('pdfinfo', [String(world.pdf)]);
  const match = info.salida.match(/^Pages:\s+(\d+)/m);
  if (match === null) throw new Error(`pdfinfo no dijo cuántas páginas tiene ${String(world.pdf)}: ${info.error}`);
  const leidas = Number.parseInt(match[1] ?? '0', 10);
  if (leidas !== paginas) {
    throw new Error(`el PDF tiene ${leidas} páginas y son ${paginas}`);
  }
});

Then('la página {int} del PDF conserva el color', (pagina: number) => {
  const pix = pixelDeLaPagina(pagina);
  const [r, g, b] = pix;
  if (r === g && g === b) {
    throw new Error(`la página ${pagina} es gris (${pix.join(',')}) y debería conservar su color`);
  }
});

Then('la página {int} del PDF está en escala de grises', (pagina: number) => {
  const pix = pixelDeLaPagina(pagina);
  const [r, g, b] = pix;
  if (r !== g || g !== b) {
    throw new Error(`la página ${pagina} tiene color (${pix.join(',')}) y debería estar en grises`);
  }
});

function pixelDeLaPagina(pagina: number): number[] {
  const tmp = join(world.root, '.iteraciones', 'tmp');
  const render = corre('pdftoppm', ['-f', String(pagina), '-l', String(pagina), '-r', '20', '-png', String(world.pdf), join(tmp, 'pagina')]);
  if (render.codigo !== 0) throw new Error(`pdftoppm no pudo renderizar la página ${pagina}: ${render.error}`);
  const archivo = readdirSync(tmp).find((f) => f.startsWith('pagina'));
  if (archivo === undefined) throw new Error('pdftoppm no dejó ninguna imagen');
  const color = corre('magick', [join(tmp, archivo), '-format', '%[pixel:p{2,2}]', 'info:']);
  const numeros = [...color.salida.matchAll(/\d+/g)].map((m) => Number.parseInt(m[0] ?? '0', 10));
  if (numeros.length < 3) throw new Error(`no pude leer el color de la página ${pagina}: ${color.salida}`);
  return numeros.slice(0, 3);
}

Then('la página {int} del PDF no dice {string}', (pagina: number, texto: string) => {
  const salida = corre('pdftotext', ['-f', String(pagina), '-l', String(pagina), String(world.pdf), '-']);
  if (salida.codigo !== 0) throw new Error(`pdftotext no pudo leer la página ${pagina}: ${salida.error}`);
  if (salida.salida.includes(texto)) {
    throw new Error(`la página ${pagina} sí dice ${JSON.stringify(texto)} y no debería`);
  }
});

Then('la página {int} del PDF dice {string}', (pagina: number, texto: string) => {
  const salida = corre('pdftotext', ['-f', String(pagina), '-l', String(pagina), String(world.pdf), '-']);
  if (salida.codigo !== 0) throw new Error(`pdftotext no pudo leer la página ${pagina}: ${salida.error}`);
  if (!salida.salida.includes(texto)) {
    throw new Error(`la página ${pagina} no dice ${JSON.stringify(texto)}`);
  }
});

Then('la página {int} del PDF es {string}', (pagina: number, portada: string) => {
  const esperada = PORTADAS.find((p) => p.campo === portada);
  if (esperada === undefined) throw new Error(`no conozco la portada ${portada}`);
  const tmp = join(world.root, '.iteraciones', 'tmp');
  const render = corre('pdftoppm', ['-f', String(pagina), '-l', String(pagina), '-r', '20', '-png', String(world.pdf), join(tmp, 'pagina')]);
  if (render.codigo !== 0) throw new Error(`pdftoppm no pudo renderizar la página ${pagina}: ${render.error}`);
  const archivo = readdirSync(tmp).find((f) => f.startsWith('pagina'));
  if (archivo === undefined) throw new Error('pdftoppm no dejó ninguna imagen');
  const color = corre('magick', [join(tmp, archivo), '-format', '%[pixel:p{2,2}]', 'info:']);
  const gris = Number.parseInt((color.salida.match(/\d+/) ?? ['0'])[0] ?? '0', 10);
  const referencia = TONOS[esperada.color] ?? 0;
  if (Math.abs(gris - referencia) > 6) {
    throw new Error(`la página ${pagina} es de gris ${gris} y la portada ${portada} es de gris ${referencia}`);
  }
});

const CONFIG_HTML = [
  'language: es-MX',
  'format:',
  '  html:',
  '    generate: true',
  '  epub:',
  '    generate: true',
  '  latex:',
  '    generate: false',
  '  pdf:',
  '    generate: false',
].join('\n');
const CONFIG_EPUB = [
  'language: es-MX',
  'format:',
  '  epub:',
  '    generate: true',
  '  html:',
  '    generate: false',
  '  latex:',
  '    generate: false',
  '  pdf:',
  '    generate: false',
].join('\n');

Given('el libro produce html', () => {
  escribirEnProyecto('iteraciones.config.yaml', `${CONFIG_HTML}\n`);
});

Given('el libro produce epub', () => {
  escribirEnProyecto('iteraciones.config.yaml', `${CONFIG_EPUB}\n`);
});

Then('las portadas del HTML van después del header y antes del título', () => {
  const html = readFileSync(join(world.root, 'dist', 'files', 'un-libro.html'), 'utf8');
  const header = html.indexOf('id="card-identity"');
  const front = html.indexOf('portada-front-');
  const back = html.indexOf('portada-back-');
  const titulo = html.indexOf('<h1');
  if (header < 0 || front < 0 || back < 0 || titulo < 0) throw new Error('faltan el header, las portadas o el título');
  if (!(header < front && front < back && back < titulo)) {
    throw new Error('las portadas no van después del header y antes del título');
  }
});

Then('el EPUB {string} lleva la portada como cover', (relativa: string) => {
  const epub = join(world.root, relativa);
  const lista = Bun.spawnSync(['unzip', '-l', epub]).stdout.toString();
  if (!lista.includes('cover.xhtml')) throw new Error(`el EPUB ${relativa} no tiene cover.xhtml`);
  const opf = Bun.spawnSync(['unzip', '-p', epub, 'EPUB/content.opf']).stdout.toString();
  if (!opf.includes('cover-image')) throw new Error(`el EPUB ${relativa} no marca la imagen de cover`);
});
