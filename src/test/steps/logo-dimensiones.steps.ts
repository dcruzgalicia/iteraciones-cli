import { Then, When } from '@cucumber/cucumber';
import { logoBlockHtml } from '../../builder/html-composer.js';

let bloque = '';

When('genero el bloque del logo con tamaño {string}', (size: string) => {
  bloque = logoBlockHtml('./assets/images/logo.webp', size);
});

Then('el logo declara ancho y alto de {int}', (size: number) => {
  if (!bloque.includes(`width="${size}"`) || !bloque.includes(`height="${size}"`)) {
    throw new Error(`el logo no declara ${size}x${size}:\n${bloque}`);
  }
});
