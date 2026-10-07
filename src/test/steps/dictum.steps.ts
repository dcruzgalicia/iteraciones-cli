import { Given, Then, When } from '@cucumber/cucumber';
import { dictumWidthWarnings, dictumWidthWarningsInYaml } from '../../builder/project-validator.js';
import { world } from './cli-world.steps.ts';

/**
 * #2580 (onda 2) — el ancho de los dictum (#2500).
 *
 * ## Dos modos y un solo parámetro
 *
 * El **body** de un documento trae cercas de código, y un `width=5` dentro de un
 * ejemplo es contenido, no una configuración. El **fragmento YAML** que se le
 * pasa ya viene limpio, así que ahí se cuenta todo. La distinción queda en un
 * booleano porque el escáner es el mismo (#2500 unificó los dos).
 *
 * ## El rango es 0.1 a 1.0
 *
 * Un dictum es un texto corrido: un ancho de 5 caracteres no cabe nada, y uno de
 * 1.5 "caracteres" no es un ancho. Ambos extremos son errores, y el aviso lleva
 * el número de línea real del archivo, no el del fragmento.
 *
 * ## Un `width` entrecomillado se escapa del escáner
 *
 * La regex exige dígitos justo después del `=`. Está aquí para que un cambio de
 * regex sea **deliberado**: si alguien la ensancha, este escenario falla y
 * preguntas por qué cambió, en vez de aceptarlo sin mirar.
 */

interface Aviso {
  line: number;
  value: number;
}

/** El texto con las dos cercas: una antes y otra después del ejemplo. */
const CON_CERCA = ['::: {.dictum width=5}', 'primero', '```', '::: {.dictum width=9}', 'dentro de la cerca', '```', '::: {.dictum width=0.5}'].join(
  '\n',
);

Given('un documento con dictums dentro y fuera de una cerca de código', () => {
  world.textoDictum = CON_CERCA;
});

Given('el texto:', (texto: string) => {
  world.textoDictum = texto;
});

Given('el desplazamiento de línea es {int}', (desplazamiento: number) => {
  world.desplazamientoDictum = desplazamiento;
});

When('escaneo los anchos del body', () => {
  world.avisosDictum = dictumWidthWarnings(world.textoDictum as string, world.desplazamientoDictum as number | undefined);
});

When('escaneo los anchos del fragmento YAML', () => {
  world.avisosDictum = dictumWidthWarningsInYaml(world.textoDictum as string);
});

Then('no hay ningún ancho fuera de rango', () => {
  const avisos = world.avisosDictum as Aviso[];
  if (avisos.length > 0) throw new Error(`hay avisos: ${JSON.stringify(avisos)}`);
});

/** `5 ;; línea 1` — el valor y dónde. */
Then('los anchos fuera de rango son:', (lista: string) => {
  const leidos = (world.avisosDictum as Aviso[]).map((a) => `${a.value} ;; línea ${a.line}`).join('\n');
  const queried = lista
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
  if (leidos !== queried) {
    throw new Error(`los anchos fuera de rango son\n${leidos}\ny debían ser\n${queried}`);
  }
});
