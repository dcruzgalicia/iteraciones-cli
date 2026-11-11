import { Then, When } from '@cucumber/cucumber';
import { type CollectionEntry, collectionCardsContent } from '../../builder/pipeline-formats.js';

let tarjeta = '';

When('genero una tarjeta de colección con título enlazado', () => {
  const entrada: CollectionEntry = {
    file: 'documento.md',
    posicion: 1,
    title: 'Documento',
    creator: [],
    subtitle: undefined,
    type: 'file',
    lineLength: undefined,
    pages: undefined,
    body: 'Contenido.',
  };
  tarjeta = collectionCardsContent([entrada], new Map([['documento.md', './documento.html']]), '');
});

Then('el enlace del título tiene la clase {string}', (clase: string) => {
  if (!tarjeta.includes(`class="${clase}`) && !tarjeta.includes(` ${clase} `) && !tarjeta.includes(` ${clase}"`)) {
    throw new Error(`la tarjeta no incluye la clase ${JSON.stringify(clase)} en el enlace del título:\n${tarjeta.slice(0, 600)}`);
  }
});
