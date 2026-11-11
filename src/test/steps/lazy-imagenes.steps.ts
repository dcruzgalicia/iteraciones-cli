import { Then, When } from '@cucumber/cucumber';
import { type CollectionEntry, collectionCardsContent } from '../../builder/pipeline-formats.js';

let tarjeta = '';

When('genero dos tarjetas de colección con imagen', () => {
  const entrada = (file: string, title: string): CollectionEntry => ({
    file,
    posicion: 1,
    title,
    creator: [],
    subtitle: undefined,
    type: 'file',
    lineLength: undefined,
    pages: undefined,
    dirAbs: '/proyecto',
    body: '![foto](foto.jpg)',
  });
  const entradas = [entrada('uno.md', 'Uno'), entrada('dos.md', 'Dos')];
  const hrefs = new Map([
    ['uno.md', './uno.html'],
    ['dos.md', './dos.html'],
  ]);
  const imagenes = new Map([
    ['/proyecto/foto.jpg', './assets/images/foto.webp'],
  ]);
  tarjeta = collectionCardsContent(entradas, hrefs, '', new Map(), '.', undefined, undefined, undefined, imagenes);
});

function etiquetaImagen(indice: number): string {
  let posicion = tarjeta.indexOf('<img');
  for (let i = 0; i < indice; i++) posicion = tarjeta.indexOf('<img', posicion + 1);
  if (posicion === -1) throw new Error(`no se encontró la imagen ${indice + 1}`);
  return tarjeta.slice(posicion, tarjeta.indexOf('>', posicion) + 1);
}

Then('la primera imagen no es lazy', () => {
  if (etiquetaImagen(0).includes('loading="lazy"')) throw new Error('la primera imagen es lazy y no debería');
});

Then('la segunda imagen es lazy', () => {
  if (!etiquetaImagen(1).includes('loading="lazy"')) throw new Error('la segunda imagen no es lazy');
});
