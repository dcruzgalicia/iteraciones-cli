import { Then, When } from '@cucumber/cucumber';
import { SiteConfigSchema } from '../../config/config-schema.js';
import { composeHtmlTemplate } from '../../builder/html-composer.js';

let plantilla = '';

function posicion(marca: string): number {
  const indice = plantilla.indexOf(marca);
  if (indice === -1) throw new Error(`la plantilla no contiene ${JSON.stringify(marca)}`);
  return indice;
}

When('compongo la plantilla HTML para revisar el orden móvil', async () => {
  plantilla = await composeHtmlTemplate(SiteConfigSchema.parse({}), 'file');
});

Then('el título va antes que el contenido', () => {
  if (posicion('$doc-title$') > posicion('$body$')) throw new Error('el título quedó después del contenido');
});

Then('el contenido va antes que la autora', () => {
  if (posicion('$body$') > posicion('sidebar-extras')) throw new Error('la autora quedó antes del contenido');
});

Then('la autora va antes que los formatos', () => {
  if (posicion('sidebar-extras') > posicion('Formatos')) throw new Error('los formatos quedaron antes de la autora');
});

Then('los formatos van antes que la licencia', () => {
  if (posicion('Formatos') > posicion('$license$')) throw new Error('la licencia quedó antes de los formatos');
});
