import { join } from 'node:path';
import { Given, Then } from '@cucumber/cucumber';
import { escribirEnProyecto, raiz, world } from './cli-world.steps.js';

function imagen(nombre: string, color: string): void {
  const resultado = Bun.spawnSync(['magick', '-size', '400x600', `xc:${color}`, join(world.root, nombre)]);
  if (resultado.exitCode !== 0) throw new Error(`no se pudo crear ${nombre}: ${resultado.stderr.toString()}`);
}

Given('un proyecto con una colección y un EPUB con portada y metadatos', () => {
  raiz();
  escribirEnProyecto(
    'iteraciones.config.yaml',
    ['language: es-MX', 'toc: true', 'format:', '  html:', '    generate: true', '  epub:', '    generate: true'].join('\n'),
  );
  imagen('portada.jpg', 'skyblue');
  imagen('ilustracion.jpg', 'salmon');
  escribirEnProyecto(
    'cap1.md',
    '---\ntitle: Capítulo uno\ncreator:\n  - Ana Ruiz\n---\n\n# Sección interna\n\nTexto del capítulo uno.\n\n![Ilustración](ilustracion.jpg)\n',
  );
  escribirEnProyecto('cap2.md', '---\ntitle: Capítulo dos\ncreator:\n  - Ana Ruiz\n---\n\n# Otra sección\n\nTexto del capítulo dos.\n');
  escribirEnProyecto(
    'libro.md',
    [
      '---',
      'title: Libro',
      'type: collection',
      'description: Descripción del libro',
      'rights: Derechos reservados',
      'license: false',
      'keywords:',
      '  - pruebas',
      'titleImage: portada.jpg',
      'files:',
      '  - cap1.md',
      '  - cap2.md',
      '---',
      '',
      'Introducción.',
    ].join('\n'),
  );
});

function listaEpub(nombre: string): string {
  const epub = join(world.root, 'dist', 'files', `${nombre}.epub`);
  const resultado = Bun.spawnSync(['unzip', '-l', epub]);
  if (resultado.exitCode !== 0) throw new Error(`no se pudo leer ${nombre}.epub: ${resultado.stderr.toString()}`);
  return resultado.stdout.toString();
}

Then('el EPUB {string} tiene al menos {int} capítulos XHTML', (nombre: string, minimo: number) => {
  const capitulos = listaEpub(nombre).match(/text\/ch\d+\.xhtml/g)?.length ?? 0;
  if (capitulos < minimo) throw new Error(`el EPUB ${nombre} tiene ${capitulos} capítulos XHTML y debía tener al menos ${minimo}`);
});

Then('el EPUB {string} tiene en el índice {string}', (nombre: string, texto: string) => {
  const epub = join(world.root, 'dist', 'files', `${nombre}.epub`);
  const resultado = Bun.spawnSync(['unzip', '-p', epub, 'EPUB/nav.xhtml']);
  if (resultado.exitCode !== 0) throw new Error(`no se pudo leer el índice de ${nombre}.epub: ${resultado.stderr.toString()}`);
  const nav = resultado.stdout.toString();
  if (!nav.includes(texto)) throw new Error(`el índice de ${nombre} no incluye ${JSON.stringify(texto)}`);
});

Then('el EPUB {string} incluye una imagen', (nombre: string) => {
  if (!/media\/.+\.(jpg|jpeg|png|webp)/i.test(listaEpub(nombre))) {
    throw new Error(`el EPUB ${nombre} no incluye imágenes en media/`);
  }
});

function archivosEpub(nombre: string): string[] {
  const epub = join(world.root, 'dist', 'files', `${nombre}.epub`);
  const resultado = Bun.spawnSync(['unzip', '-Z1', epub]);
  if (resultado.exitCode !== 0) throw new Error(`no se pudo listar ${nombre}.epub: ${resultado.stderr.toString()}`);
  return resultado.stdout
    .toString()
    .split('\n')
    .filter((linea) => linea.trim() !== '');
}

Then('el EPUB {string} no incluye fuentes incrustadas', (nombre: string) => {
  const fuentes = archivosEpub(nombre).filter((archivo) => /\.(woff2?|ttf|otf)$/i.test(archivo));
  if (fuentes.length > 0) throw new Error(`el EPUB ${nombre} incrusta fuentes: ${fuentes.join(', ')}`);
});

Then('el EPUB {string} no tiene @font-face', (nombre: string) => {
  const epub = join(world.root, 'dist', 'files', `${nombre}.epub`);
  for (const archivo of archivosEpub(nombre).filter((ruta) => ruta.endsWith('.css'))) {
    const resultado = Bun.spawnSync(['unzip', '-p', epub, archivo]);
    if (resultado.exitCode !== 0) throw new Error(`no se pudo leer ${archivo} de ${nombre}.epub`);
    if (resultado.stdout.toString().includes('@font-face')) {
      throw new Error(`el EPUB ${nombre} declara @font-face en ${archivo}`);
    }
  }
});

Then('las imágenes del EPUB {string} pesan menos de {int} KB', (nombre: string, kb: number) => {
  const epub = join(world.root, 'dist', 'files', `${nombre}.epub`);
  const resultado = Bun.spawnSync(['unzip', '-l', epub]);
  if (resultado.exitCode !== 0) throw new Error(`no se pudo listar ${nombre}.epub: ${resultado.stderr.toString()}`);
  const imagenes = resultado.stdout
    .toString()
    .split('\n')
    .filter((linea) => /media\/.+\.(jpg|jpeg|png|webp)$/i.test(linea))
    .map((linea) => Number.parseInt(linea.trim().split(/\s+/)[0] ?? '0', 10));
  if (imagenes.length === 0) throw new Error(`el EPUB ${nombre} no tiene imágenes en media/`);
  for (const bytes of imagenes) {
    if (!Number.isFinite(bytes) || bytes <= 0 || bytes > kb * 1024) {
      throw new Error(`una imagen de ${nombre}.epub pesa ${bytes} bytes y debía pesar menos de ${kb} KB`);
    }
  }
});
