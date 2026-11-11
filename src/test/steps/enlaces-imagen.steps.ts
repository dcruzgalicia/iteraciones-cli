import { Then, When } from '@cucumber/cucumber';
import { type CollectionEntry, collectionCardsContent } from '../../builder/pipeline-formats.js';

let tarjeta = '';

When('genero una tarjeta de colección con imagen', () => {
  const entrada: CollectionEntry = {
    file: 'documento.md',
    posicion: 1,
    title: 'Documento',
    creator: [],
    subtitle: undefined,
    type: 'file',
    lineLength: undefined,
    pages: undefined,
    dirAbs: '/proyecto',
    body: '![foto](foto.jpg)',
  };
  const hrefs = new Map([['documento.md', './documento.html']]);
  const imagenes = new Map([['/proyecto/foto.jpg', './assets/images/foto.webp']]);
  tarjeta = collectionCardsContent([entrada], hrefs, '', new Map(), '.', undefined, undefined, undefined, imagenes);
});

Then('el enlace de la imagen dice {string}', (etiqueta: string) => {
  if (!tarjeta.includes(`aria-label="${etiqueta}"`)) throw new Error(`la tarjeta no tiene aria-label="${etiqueta}":\n${tarjeta.slice(0, 600)}`);
});

Then('la imagen sigue con alt vacío', () => {
  if (!tarjeta.includes('alt=""')) throw new Error('la imagen dejó de ser decorativa');
});
