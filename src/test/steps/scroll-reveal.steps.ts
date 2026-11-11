import { join } from 'node:path';
import { Then, When } from '@cucumber/cucumber';

let css = '';

When('leo la utilidad scroll-reveal', async () => {
  css = await Bun.file(join(import.meta.dir, '../../lib/resources/styles.css')).text();
});

Then('su keyframe no contiene {string}', (propiedad: string) => {
  const inicio = css.indexOf('@keyframes scroll-reveal');
  if (inicio === -1) throw new Error('no se encontró @keyframes scroll-reveal');
  const fin = css.indexOf('@utility', inicio);
  const bloque = css.slice(inicio, fin === -1 ? undefined : fin);
  if (bloque.includes(propiedad)) throw new Error(`scroll-reveal anima ${propiedad}:\n${bloque}`);
});
