import { spyOn } from 'bun:test';
import { Given, Then, When } from '@cucumber/cucumber';
import { buildFormatsArgs, buildFormatsFlag, type FormatsLink } from '../../builder/html-composer.js';
import { extractReferencesBlock, moveCollectionIntro, removeTocReferencesLink } from '../../builder/html-postprocess.js';
import * as logger from '../../lib/logger.js';
import { world } from './cli-world.steps.ts';

const TARJETA = '<div class="wrap"><h2 id="refs-heading" class="chip">Referencias</h2>{{refs-list}}</div>';
const MARCADOR = '<div id="block-referencias"></div>';

Given('que el HTML es:', (html: string) => {
  world.htmlEntrada = html.replace(/<br>/g, '\n');
});

Given('que el HTML lleva el marcador de referencias', () => {
  world.htmlEntrada = world.htmlEntrada + MARCADOR;
});

When('extraigo el bloque de referencias', () => {
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

Then('ningún argumento de formatos lleva HTML ni saltos', () => {
  for (const arg of (world.argsFormatos as string[]) ?? []) {
    if (arg.includes('<') || arg.includes('\n')) {
      throw new Error(`el argumento ${JSON.stringify(arg)} lleva HTML o un salto`);
    }
  }
});
