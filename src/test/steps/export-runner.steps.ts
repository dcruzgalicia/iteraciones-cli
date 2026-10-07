import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Given, Then, When } from '@cucumber/cucumber';
import { convertToMarkdown } from '../../builder/export.js';
import { world } from './cli-world.steps.ts';

const BODY = '---\ntitle: "Mi título"\ncreator: [Autor Uno, Autor Dos]\ndate: 2026-08-08\n---\n\nHola.\n';

const META = {
  title: 'Mi título',
  creator: ['Autor Uno', 'Autor Dos'],
  date: '8 de agosto de 2026',
  dateIso: '2026-08-08',
  language: 'es-MX',
  toc: false,
};

Given('un documento con título, dos autores y fecha', () => {
  world.cuerpoOrigen = BODY;
  world.metaExport = { ...META };
});

Given('un documento sin autores ni fecha', () => {
  world.cuerpoOrigen = '---\ntitle: "Mi título"\n---\n\nHola.\n';
  world.metaExport = { ...META, creator: [], date: undefined, dateIso: undefined };
});

Given('un documento con bibliografía y CSL propio', () => {
  world.metaExport = {
    ...META,
    bibliography: join(world.root, 'refs.bib'),
    csl: join(world.root, 'nature.csl'),
  };
});

When('exporto el documento a {string}', async (salida: string) => {
  await convertToMarkdown(world.cuerpoOrigen as string, salida, {
    filePath: '/proyecto/test.md',
    relativePath: 'test.md',
    metadata: world.metaExport as never,
  } as never);
  world.exportLeido = readFileSync(salida, 'utf8');
});

When('vuelvo a exportar mi propia salida a {string}', async (destino: string) => {
  const salida = join(world.root, 'a.md');
  await convertToMarkdown(world.cuerpoOrigen as string, salida, {
    filePath: '/proyecto/test.md',
    relativePath: 'test.md',
    metadata: world.metaExport as never,
  } as never);
  const primera = readFileSync(salida, 'utf8');
  await convertToMarkdown(primera, destino, {
    filePath: '/proyecto/test.md',
    relativePath: 'test.md',
    metadata: world.metaExport as never,
  } as never);
  world.exportLeido = readFileSync(destino, 'utf8');
  world.exportOriginal = primera;
});

Then('el markdown empieza con el frontmatter', () => {
  if (!String(world.exportLeido).startsWith('---\n')) {
    throw new Error(`el markdown empieza con ${JSON.stringify(String(world.exportLeido).slice(0, 20))}`);
  }
});

Then('el markdown termina con el cuerpo intacto', () => {
  const leido = String(world.exportLeido);
  if (!leido.endsWith('---\n\nHola.\n')) {
    throw new Error(`el markdown termina con ${JSON.stringify(leido.slice(-30))}, sin el cuerpo intacto`);
  }
});

Then('el markdown declara:', (lista: string) => {
  const leido = String(world.exportLeido);
  const faltan = lista
    .split('\n')
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => !leido.includes(t));
  if (faltan.length > 0) throw new Error(`al markdown le faltan ${JSON.stringify(faltan)}`);
});

Then('el markdown NO declara:', (lista: string) => {
  const leido = String(world.exportLeido);
  const sobran = lista
    .split('\n')
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => leido.includes(t));
  if (sobran.length > 0) throw new Error(`el markdown dice ${JSON.stringify(sobran)} y no debería`);
});

Then('el markdown no lleva la ruta del proyecto', () => {
  if (String(world.exportLeido).includes(world.root as string)) {
    throw new Error('el markdown lleva una ruta absoluta del proyecto: el archivo va a otra máquina');
  }
});

Then('el markdown es byte-idéntico a su fuente', () => {
  if (world.exportLeido !== world.exportOriginal) {
    throw new Error('re-procesar el export cambió el archivo: el build no sería idempotente');
  }
});
