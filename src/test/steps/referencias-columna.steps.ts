import { Then, When } from '@cucumber/cucumber';
import { SiteConfigSchema } from '../../config/config-schema.js';
import { composeHtmlTemplate } from '../../builder/html-composer.js';

let plantilla = '';

When('compongo la plantilla HTML de un archivo', async () => {
  plantilla = await composeHtmlTemplate(SiteConfigSchema.parse({}), 'file');
});

Then('el bloque de referencias queda después del slot relacionado', () => {
  const relacionado = plantilla.indexOf('id="slot-related"');
  const referencias = plantilla.indexOf('id="block-referencias"');
  if (relacionado === -1) throw new Error('la plantilla no tiene slot relacionado');
  if (referencias === -1) throw new Error('la plantilla no tiene bloque de referencias');
  if (referencias < relacionado) throw new Error('el bloque de referencias quedó antes del slot relacionado');
});

