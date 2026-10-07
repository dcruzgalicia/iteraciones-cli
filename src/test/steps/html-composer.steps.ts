import { spyOn } from 'bun:test';
import { Given, Then, When } from '@cucumber/cucumber';
import { buildFormatsArgs, buildFormatsFlag, type FormatsLink } from '../../builder/html-composer.js';
import { extractReferencesBlock, moveCollectionIntro, removeTocReferencesLink } from '../../builder/html-postprocess.js';
import * as logger from '../../lib/logger.js';
import { world } from './cli-world.steps.ts';

/**
 * #2580 (onda 2) — el post-procesado del HTML.
 *
 * pandoc devuelve el HTML con la tarjeta de referencias dentro del `<article>`
 * y el cuerpo de la colección mezclado con el de sus miembros. El post-proceso
 * lo saca de ahí y lo pone en su sitio, y si el HTML está mal balanceado lo
 * devuelve intacto en vez de dejarlo a medias.
 *
 * ## El HTML va en docstring y no en tabla
 *
 * Son cadenas de varias líneas con comillas y llaves. Una celda de `Examples`
 * no las lleva, y escaparlas a mano es el mismo problema que con el JSON del
 * crop: cada herramienta desescapa distinto. El docstring no escapa nada.
 */

/** La tarjeta de referencias con su marcador, como la deja el recurso. */
const TARJETA = '<div class="wrap"><h2 id="refs-heading" class="chip">Referencias</h2>{{refs-list}}</div>';
const MARCADOR = '<!-- block:referencias -->';

Given('que el HTML es:', (html: string) => {
  world.htmlEntrada = html.replace(/<br>/g, '\n');
});

Given('que el HTML lleva el marcador de referencias', () => {
  world.htmlEntrada = world.htmlEntrada + MARCADOR;
});

When('extraigo el bloque de referencias', () => {
  // `extractReferencesBlock` avisa por su cuenta cuando el HTML no queda
  // balanceado, así que el espía va aquí: sin él, el paso que comprueba el
  // aviso lee una cadena vacía y pasa sin comprobar nada.
  const espia = spyOn(logger, 'logWarning').mockImplementation(() => undefined);
  try {
    const resultado = extractReferencesBlock(world.htmlEntrada, TARJETA);
    world.bloqueRefs = resultado.block;
    world.htmlSalida = resultado.html;
    world.avisosHtml = espia.mock.calls.map((c) => String(c[0]));
  } finally {
    espia.mockRestore();
  }
});

When('quito el enlace a referencias del índice', () => {
  world.htmlSalida = removeTocReferencesLink(world.htmlEntrada);
});

Given('que los formatos son {string}', (lista: string) => {
  world.formatos = JSON.parse(lista) as FormatsLink[];
  // El `key` del config es un tipo cerrado; el JSON del feature es texto plano.
});

When('compongo el flag de formatos', () => {
  world.flagFormatos = buildFormatsFlag(world.formatos);
});

When('compongo los argumentos de formatos', () => {
  world.argsFormatos = buildFormatsArgs(world.formatos);
});

When('subo el body propio a la banda', () => {
  const espia = spyOn(logger, 'logWarning').mockImplementation(() => undefined);
  try {
    world.htmlSalida = moveCollectionIntro(world.htmlEntrada);
    world.avisosHtml = espia.mock.calls.map((c) => String(c[0]));
  } finally {
    espia.mockRestore();
  }
});

Then('el bloque de referencias se extrajo', () => {
  if (world.bloqueRefs === undefined) throw new Error('el bloque no se extrajo');
});

Then('el bloque de referencias no se extrajo', () => {
  if (world.bloqueRefs !== undefined) {
    throw new Error(`el bloque se extrajo y no debía: ${JSON.stringify(world.bloqueRefs.slice(0, 80))}`);
  }
});

Then('el post-proceso no tocó el HTML', () => {
  if (world.htmlSalida !== world.htmlEntrada) {
    throw new Error(`el post-proceso cambió el HTML y no debía:\n${world.htmlSalida}`);
  }
});

Then('el post-proceso deja {string}', (texto: string) => {
  if (!world.htmlSalida.includes(texto)) {
    throw new Error(`el post-proceso no dice ${JSON.stringify(texto)}:\n${world.htmlSalida}`);
  }
});

Then('el post-proceso quita {string}', (texto: string) => {
  if (world.htmlSalida.includes(texto)) {
    throw new Error(`el post-proceso sí dice ${JSON.stringify(texto)} y no debería`);
  }
});

Then('el post-proceso pone {string} antes que {string}', (primero: string, segundo: string) => {
  const a = world.htmlSalida.indexOf(primero);
  const b = world.htmlSalida.indexOf(segundo);
  if (a < 0) throw new Error(`el post-proceso no tiene ${JSON.stringify(primero)}`);
  if (a >= b) throw new Error(`${JSON.stringify(primero)} no va antes que ${JSON.stringify(segundo)}`);
});

Then('el post-proceso avisa que {string}', (motivo: string) => {
  const avisos = (world.avisosHtml ?? []).join(' ');
  if (!avisos.includes(motivo)) {
    throw new Error(`el post-proceso no avisó ${JSON.stringify(motivo)}. Avisó: ${JSON.stringify(avisos)}`);
  }
});

Then('el flag de formatos no existe', () => {
  if (world.flagFormatos !== undefined) {
    throw new Error(`el flag existe y no debería: ${JSON.stringify(world.flagFormatos)}`);
  }
});

Then('el flag de formatos es {string}', (esperado: string) => {
  if (world.flagFormatos !== esperado) {
    throw new Error(`el flag es ${JSON.stringify(world.flagFormatos)} y debería ser ${JSON.stringify(esperado)}`);
  }
});

Then('los argumentos de formatos son {string}', (esperados: string) => {
  const leidos = (world.argsFormatos as string[]).join(', ');
  if (leidos !== esperados) {
    throw new Error(`son ${JSON.stringify(leidos)} y deberían ser ${JSON.stringify(esperados)}`);
  }
});

/**
 * Un `<` en un `--variable` de pandoc rompe el argv: el valor se corta en el
 * primer espacio y el formato sale con el href a medias. Por eso el markup de
 * la tarjeta vive en la plantilla y el argv sólo lleva un valor corto.
 */
Then('ningún argumento de formatos lleva HTML ni saltos', () => {
  for (const arg of (world.argsFormatos as string[]) ?? []) {
    if (arg.includes('<') || arg.includes('\n')) {
      throw new Error(`el argumento ${JSON.stringify(arg)} lleva HTML o un salto`);
    }
  }
});
