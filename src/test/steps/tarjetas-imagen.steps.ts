import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { Given, Then } from '@cucumber/cucumber';
import { posix } from '../../lib/paths.js';
import { escribirEnProyecto, world } from './cli-world.steps.ts';

function crearImagen(ruta: string, color = 'red'): void {
  escribirEnProyecto(ruta, new Uint8Array());
  const proc = Bun.spawnSync(['magick', '-size', '120x80', `xc:${color}`, join(world.root, ruta)]);
  if (proc.exitCode !== 0) throw new Error(`magick no pudo crear ${ruta}`);
}

Given('un texto en {string} que empieza con la imagen {string}', (dir: string, archivo: string) => {
  crearImagen(`${dir}/${archivo}`);
  escribirEnProyecto(`${dir}/tres-libros.md`, `---\ntitle: Tres libros\n---\n\n![Mapa](${archivo})\n\nPrimer párrafo del texto.\n`);
});

Given('un texto de {string} en {string} que empieza con la imagen {string}', (nombre: string, dir: string, archivo: string) => {
  crearImagen(`${dir}/${archivo}`);
  escribirEnProyecto(
    `${dir}/tres-libros.md`,
    `---\ntitle: Tres libros\ncreator: ${nombre}\n---\n\n![Mapa](${archivo})\n\nPrimer párrafo del texto.\n`,
  );
});

Given('una colección en {string} que incluye {string}', (dir: string, archivo: string) => {
  const ruta = posix(relative(dir, archivo));
  escribirEnProyecto(`${dir}/antologia.md`, `---\ntitle: Antología\ntype: collection\nfiles:\n  - ./${ruta}\n---\n\nIntro.\n`);
});

Given('una creadora llamada {string} con retrato {string}', (nombre: string, archivo: string) => {
  crearImagen(archivo, 'blue');
  escribirEnProyecto('ana-garcia.md', `---\ntype: creator\nname: ${nombre}\nimage: ${archivo}\n---\n\nBio de ${nombre}.\n`);
});

Given('una creadora llamada {string} cuyo retrato {string} no existe', (nombre: string, archivo: string) => {
  escribirEnProyecto('ana-garcia.md', `---\ntype: creator\nname: ${nombre}\nimage: ${archivo}\n---\n\nBio de ${nombre}.\n`);
});

Then('el archivo {string} pone {string} antes que {string}', (relativa: string, primero: string, segundo: string) => {
  const html = readFileSync(join(world.root, relativa), 'utf8');
  const a = html.indexOf(primero);
  const b = html.indexOf(segundo);
  if (a < 0) throw new Error(`${relativa} no dice ${JSON.stringify(primero)}`);
  if (b < 0) throw new Error(`${relativa} no dice ${JSON.stringify(segundo)}`);
  if (a > b) throw new Error(`en ${relativa} ${JSON.stringify(primero)} va después de ${JSON.stringify(segundo)}`);
});
