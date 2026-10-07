import { Given, Then, When } from '@cucumber/cucumber';
import { looseColonLines, looseColonsMessage } from '../../builder/project-validator.js';
import { world } from './cli-world.steps.ts';

Given('que el cuerpo del documento es:', (cuerpo: string) => {
  world.cuerpoVoc = cuerpo.replace(/<br>/g, '\n');
});

Given('que el frontmatter ocupa {int} líneas', (lineas: number) => {
  world.offsetColones = lineas;
});

When('busco las colones sueltas', () => {
  world.colones = looseColonLines(world.cuerpoVoc, world.offsetColones);
});

Then('las colones sueltas están en las líneas {string}', (esperadas: string) => {
  const leidas = (world.colones as number[]).join(', ');
  if (leidas !== esperadas) {
    throw new Error(`están en ${JSON.stringify(leidas)} y deberían estar en ${JSON.stringify(esperadas)}`);
  }
});

Then('no hay colones sueltas', () => {
  if ((world.colones as number[]).length > 0) {
    throw new Error(`hay colones sueltas en ${JSON.stringify(world.colones)} y no debería haber ninguna`);
  }
});

When('armo el aviso de las colones sueltas', () => {
  world.avisoColones = looseColonsMessage(world.colones as number[]);
});

Then('el aviso de colones dice {string}', (motivo: string) => {
  const leido = world.avisoColones as string;
  if (leido !== motivo) {
    throw new Error(`el aviso dice ${JSON.stringify(leido)} y debería decir ${JSON.stringify(motivo)}`);
  }
});
