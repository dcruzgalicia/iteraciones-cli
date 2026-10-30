import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Then } from '@cucumber/cucumber';
import { world } from './cli-world.steps.js';

Then('la licencia de {string} va antes de la segunda Redes', (relativa: string) => {
  const html = readFileSync(join(world.root, relativa), 'utf8');
  const licencia = html.indexOf('Algunos derechos reservados.');
  if (licencia < 0) throw new Error(`${relativa} no tiene la tarjeta de licencia`);
  const redes = [...html.matchAll(/>Redes</g)].map((m) => m.index ?? -1);
  if (redes.length < 2) throw new Error(`${relativa} tiene ${redes.length} tarjetas de Redes y deberían ser 2`);
  const segunda = redes[redes.length - 1] as number;
  if (licencia > segunda) throw new Error(`en ${relativa} la licencia va después de la segunda Redes`);
});
