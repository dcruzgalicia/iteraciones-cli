import { After, Before, Given, Then } from '@cucumber/cucumber';
import { looseColonLines } from '../../builder/project-validator.js';

/**
 * #2543 — step definitions del vocabulario del cuerpo.
 *
 * **Los imports van en inglés aunque el feature sea español.** @cucumber/cucumber
 * v13 sólo exporta nombres en inglés (`Given`, `Before`, `Status`…): no existen
 * `Dado`, `Cuando`, `Entonces`, `Antes` ni `Después`. El idioma lo pone
 * `i18n.languages: ['es']` en `cucumber.json`, que traduce las keywords del
 * feature al cargar — el runner reporta los snippets como `Given('un cuerpo:')`
 * para un step que en el .feature dice `Dado un cuerpo:`. Los dos mecanismos son
 * independientes: keywords por `i18n`, bindings por los exports en inglés.
 *
 * **Ojo con `i18n` ausente:** sin esa línea, un feature en `Dado/Cuando/Entonces`
 * con steps en inglés reporta `N undefined` **sin ningún error**. Parece verde y
 * no comprueba nada. Trampa 1 del spike, verificada.
 *
 * **Los datos estructurados viajan como string y se parsean aquí.** Una
 * expression tipo `Then las líneas reportadas son [3]` matchea con codicia y
 * genera snippets basura (trampa 2). Para tablas: `Scenario Outline` con
 * `Examples`. Para varias líneas: docstring, como aquí.
 *
 * **El world es un objeto compartido mutable.** Un `Given` escribe, un `Then`
 * lee. Por eso vive en `world` y no en una variable de módulo, y por eso los
 * hooks lo limpian: cucumber NO aísla escenarios como hace `bun test`.
 */

interface VocabularioWorld {
  cuerpo: string;
}

const world: VocabularioWorld = { cuerpo: '' };

Before(() => {
  world.cuerpo = '';
});

After(() => {
  world.cuerpo = '';
});

Given('un cuerpo:', (cuerpo: string) => {
  world.cuerpo = cuerpo;
});

Then('las líneas reportadas son {string}', (expected: string) => {
  // Se parsea lo expected en vez de comparar strings: en el .feature se puede
  // escribir "[1, 5, 7]" con espacios, que es más legible, sin que eso cambie
  // el resultado. Comparar contra JSON.stringify obligaría a escribirlo sin
  // espacios y el feature quedaría peor de leer a cambio de nada.
  const expectedLines: number[] = JSON.parse(expected);
  const actual = looseColonLines(world.cuerpo);
  if (JSON.stringify(actual) !== JSON.stringify(expectedLines)) {
    throw new Error(`esperaba ${expected} y obtuve ${JSON.stringify(actual)} para el cuerpo:\n${JSON.stringify(world.cuerpo)}`);
  }
});
