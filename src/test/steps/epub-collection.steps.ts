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

