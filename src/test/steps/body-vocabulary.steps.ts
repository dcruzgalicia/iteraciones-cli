import { Given, Then, When } from '@cucumber/cucumber';
import { looseColonLines, looseColonsMessage } from '../../builder/project-validator.js';
import { world } from './cli-world.steps.ts';

/**
 * #2580 (onda 2) — la `:` suelta en el cuerpo de un documento.
 *
 * Es el error de markdown más fácil de cometer y el más difícil de ver: una
 * línea con `:` sola se ve como texto en el editor y sale como texto vacío en
 * el PDF. El validador la busca y la lista con su número de línea.
 *
 * ## Por qué hay tantos "no marca"
 *
 * Todo lo que se parece a una `:` suelta y no lo es: `::` (espaciador), `:;`
 * (sin indentación), `12:30` (una hora), `https://...` (una URL), `:smile:`
 * (un emoji), `::: {.nota}` (la valla de un div) y todo lo que va dentro de
 * un bloque de código. Cada "no" protege a un autor que escribió algo legal;
 * un "sí" de más le dice que su texto está mal cuando no lo está.
 *
 * ## El conteo cuenta líneas de archivo, no del cuerpo
 *
 * El mensaje dice "línea 6" y el autor abre el archivo a la línea 6. Por eso
 * el offset del frontmatter se suma. Sin él el aviso apuntaría al sitio
 * equivocado justo en los documentos que tienen frontmatter, que son todos.
 */

Given('que el cuerpo del documento es:', (cuerpo: string) => {
  world.cuerpoVoc = cuerpo.replace(/<br>/g, '\n');
});

Given('que el frontmatter ocupa {int} líneas', (lineas: number) => {
  world.offsetColones = lineas;
});

When('busco las colones sueltas', () => {
  world.colones = looseColonLines(world.cuerpoVoc, world.offsetColones);
});

/**
 * Las líneas llegan separadas por comas porque cucumber no tiene un tipo lista.
 * Diez números de línea se leen mejor como una cadena que como diez pasos.
 */
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
