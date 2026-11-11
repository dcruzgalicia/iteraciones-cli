import { join } from 'node:path';
import { Then, When } from '@cucumber/cucumber';
import { logoBlockHtml } from '../../builder/html-composer.js';
import { world } from './cli-world.steps.js';

let bloque = '';

When('genero el bloque del logo con tamaño {string}', (size: string) => {
  bloque = logoBlockHtml('./assets/images/logo.webp', size);
});

Then('el logo declara ancho y alto de {int}', (size: number) => {
  if (!bloque.includes(`width="${size}"`) || !bloque.includes(`height="${size}"`)) {
    throw new Error(`el logo no declara ${size}x${size}:\n${bloque}`);
  }
});

Then('el icono {string} mide al menos {int} px', (nombre: string, minimo: number) => {
  const ruta = join(world.root, 'dist', 'files', 'assets', 'images', nombre);
  const resultado = Bun.spawnSync(['magick', 'identify', '-format', '%w %h', ruta]);
  if (resultado.exitCode !== 0) throw new Error(`no se pudo leer ${nombre}: ${resultado.stderr.toString()}`);
  const [ancho, alto] = new TextDecoder().decode(resultado.stdout).trim().split(/\s+/).map(Number);
  if (ancho === undefined || alto === undefined || ancho < minimo || alto < minimo) {
    throw new Error(`${nombre} mide ${ancho}x${alto} y debía medir al menos ${minimo}x${minimo}`);
  }
});
