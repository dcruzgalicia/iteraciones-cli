import { join } from 'node:path';
import { Then } from '@cucumber/cucumber';
import { world } from './cli-world.steps.js';

Then('el HTML del menú tiene al menos {int} listas', async (minimo: number) => {
  const html = await Bun.file(join(world.root, 'dist', 'files', 'menu.html')).text();
  const listas = html.match(/<ul\b/g)?.length ?? 0;
  if (listas < minimo) throw new Error(`menu.html tiene ${listas} listas y debía tener al menos ${minimo}`);
});
