import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Given, Then } from '@cucumber/cucumber';
import { escribirEnProyecto, world } from './cli-world.steps.ts';

Given('un texto con una imagen grande', () => {
  const proc = Bun.spawnSync(['magick', '-size', '900x600', 'gradient:#f0c7d7-#8a2a5a', join(world.root, 'grande.jpg')]);
  if (proc.exitCode !== 0) throw new Error('magick no pudo crear la imagen grande');
  escribirEnProyecto('texto.md', '---\ntitle: Texto con imagen\nslug: texto\n---\n\n![Imagen grande](./grande.jpg)\n\nContenido.\n');
});

Then('el HTML de {string} tiene imágenes responsivas', (archivo: string) => {
  const html = readFileSync(join(world.root, 'dist', 'files', archivo), 'utf8');
  if (!/<img[^>]*srcset=/.test(html)) throw new Error(`${archivo} no tiene srcset`);
  if (!/<img[^>]*sizes=/.test(html)) throw new Error(`${archivo} no tiene sizes`);
  if (!/<img[^>]*width="900"[^>]*height="600"/.test(html)) throw new Error(`${archivo} no declara dimensiones`);
  if (!/<img[^>]*loading="lazy"/.test(html)) throw new Error(`${archivo} no usa lazy loading`);
});
