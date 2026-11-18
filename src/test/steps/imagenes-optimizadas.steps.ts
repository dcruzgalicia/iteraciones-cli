import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Given, Then } from '@cucumber/cucumber';
import { escribirEnProyecto, world } from './cli-world.steps.ts';

function crearImagenGrande(): void {
  const proc = Bun.spawnSync(['magick', '-size', '900x600', 'gradient:#f0c7d7-#8a2a5a', join(world.root, 'grande.jpg')]);
  if (proc.exitCode !== 0) throw new Error('magick no pudo crear la imagen grande');
}

Given('un texto con una imagen grande', () => {
  crearImagenGrande();
  escribirEnProyecto('texto.md', '---\ntitle: Texto con imagen\nslug: texto\n---\n\n![Imagen grande](./grande.jpg)\n\nContenido.\n');
});

Given('otro texto con la misma imagen grande', () => {
  escribirEnProyecto('otro.md', '---\ntitle: Otro texto\nslug: otro\n---\n\n![Otra imagen grande](./grande.jpg)\n\nMás contenido.\n');
});

Given('una portada con textura', () => {
  const proc = Bun.spawnSync(['magick', '-size', '900x1200', '-seed', '42', 'plasma:fractal', join(world.root, 'portada.png')]);
  if (proc.exitCode !== 0) throw new Error('magick no pudo crear la portada con textura');
  const texto = readFileSync(join(world.root, 'texto.md'), 'utf8').replace(
    '---\ntitle: Texto con imagen\nslug: texto\n---',
    '---\ntitle: Texto con imagen\nslug: texto\nfrontCover: ./portada.png\n---',
  );
  escribirEnProyecto('texto.md', texto);
});

function leerHtml(archivo: string): string {
  return readFileSync(join(world.root, 'dist', 'files', archivo), 'utf8');
}

function imagenGrande(html: string): string {
  const tag = (html.match(/<img\b[^>]*>/g) ?? []).find((candidata) => /src="[^"]*-grande\.(webp|jpg)"/.test(candidata));
  if (tag === undefined) throw new Error('no se encontró la imagen grande procesada en el HTML');
  const src = /src="([^"]+)"/.exec(tag)?.[1];
  if (src === undefined) throw new Error('la imagen grande no tiene src');
  return tag;
}

function srcImagenGrande(html: string): string {
  const tag = imagenGrande(html);
  return /src="([^"]+)"/.exec(tag)?.[1] ?? '';
}

Then('el HTML de {string} tiene una imagen optimizada', (archivo: string) => {
  const html = leerHtml(archivo);
  const tag = imagenGrande(html);
  if (!tag.includes('assets/images/')) throw new Error(`${archivo} no referencia la imagen desde assets/images`);
  if (!/width="900"[^>]*height="600"/.test(tag)) throw new Error(`${archivo} no declara las dimensiones de la imagen`);
  if (!tag.includes('loading="lazy"')) throw new Error(`${archivo} no usa lazy loading`);
});

Then('la imagen de {string} pesa menos de {int} KB', (archivo: string, kb: number) => {
  const src = srcImagenGrande(leerHtml(archivo)).replace(/^\.\//, '');
  const bytes = readFileSync(join(world.root, 'dist', 'files', src)).byteLength;
  if (bytes > kb * 1024) throw new Error(`la imagen de ${archivo} pesa ${bytes} bytes y debía pesar menos de ${kb} KB`);
});

function srcPortada(html: string): string {
  const tag = (html.match(/<img\b[^>]*class="portada[^"]*"[^>]*>/) ?? [])[0];
  if (tag === undefined) throw new Error('no se encontró la portada en el HTML');
  const src = /src="([^"]+)"/.exec(tag)?.[1];
  if (src === undefined) throw new Error('la portada no tiene src');
  return src;
}

Then('la portada de {string} pesa más de {int} KB', (archivo: string, kb: number) => {
  const src = srcPortada(leerHtml(archivo)).replace(/^\.\//, '');
  const bytes = readFileSync(join(world.root, 'dist', 'files', src)).byteLength;
  if (bytes <= kb * 1024) throw new Error(`la portada de ${archivo} pesa ${bytes} bytes y debía pesar más de ${kb} KB`);
});

Then('el HTML de {string} no tiene srcset', (archivo: string) => {
  if (leerHtml(archivo).includes('srcset=')) throw new Error(`${archivo} todavía tiene srcset`);
});

Then('hay una sola imagen procesada para {string}', (nombre: string) => {
  const dir = join(world.root, 'dist', 'files', 'assets', 'images');
  const encontradas = readdirSync(dir).filter((archivo) => archivo.endsWith(`-${nombre}.webp`) || archivo.endsWith(`-${nombre}.jpg`));
  if (encontradas.length !== 1) throw new Error(`esperaba una imagen para "${nombre}" y hay ${encontradas.length}: ${encontradas.join(', ')}`);
});

Then('los HTML de {string} y {string} referencian la misma imagen', (primero: string, segundo: string) => {
  const a = srcImagenGrande(leerHtml(primero));
  const b = srcImagenGrande(leerHtml(segundo));
  if (a !== b) throw new Error(`las imágenes no coinciden: ${a} y ${b}`);
});
