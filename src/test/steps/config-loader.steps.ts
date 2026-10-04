import { spyOn } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Given, Then, When } from '@cucumber/cucumber';
import { loadSiteConfig, loadSiteConfigIfPresent, loadSiteConfigWithPresence } from '../../config/config-loader.js';
import { tempRoot, world } from './cli-world.steps.ts';

/**
 * #2580 (onda 2) — la configuración del proyecto.
 *
 * Los 49 casos de `config-loader.test.ts` son la misma pregunta con otros
 * datos: **escribo un `iteraciones.config.yaml`, lo cargo, y ¿qué pasa?** El
 * YAML es la entrada, así que el Gherkin encaja sin traducción: el `Given` es
 * literalmente el archivo que el autor escribió.
 *
 * ## Por qué hay un paso con `ruta punteada` y no uno por clave
 *
 * Catorce de los cuarenta y nueve casos son "la clave X vale Y". Un paso por
 * clave son catorce pasos que se pagan siempre y que hay que tocar cuando el
 * esquema cambia. `la configuración tiene "format.html.site.title" con valor
 * "Mi Título"` es uno solo, y el esquema se lee entero en el `Examples`.
 *
 * ## El conjunto de presencia es un segundo contrato
 *
 * `loadSiteConfigWithPresence` devuelve las claves que el autor ESCRIBIÓ,
 * separadas de las que el paquete puso por defecto. Sin esa separación,
 * `doctor --info` no puede decir "esto lo escribiste tú" y su sustracción de
 * defaults le quita al usuario claves que sí puso.
 */

/** Raíces de proyecto para estos escenarios: los pasos de build no aplican. */
function raizConfig(): string {
  world.root = tempRoot('iteraciones-cli-config-');
  return world.root;
}

function escribeConfig(contenido: string): void {
  mkdirSync(world.root, { recursive: true });
  writeFileSync(join(world.root, 'iteraciones.config.yaml'), contenido, 'utf8');
}

/** Lee `a.b.c` de un objeto, o `undefined`. */
function en(objeto: unknown, ruta: string): unknown {
  return ruta.split('.').reduce<unknown>((valor, clave) => (valor as Record<string, unknown>)?.[clave], objeto);
}

Given('que el proyecto no tiene archivo de configuración', () => {
  raizConfig();
});

Given('que el archivo de configuración es:', (yaml: string) => {
  raizConfig();
  escribeConfig(yaml);
});

When('cargo la configuración del proyecto', async () => {
  // El loader avisa por su cuenta (`no es un objeto YAML`). `capture()` sólo
  // espía dentro de un `When` que él envuelve, así que el espiado va aquí: sin
  // él, el paso que comprueba el aviso lee una cadena vacía y no prueba nada.
  const espia = spyOn(process.stderr, 'write').mockImplementation(() => true);
  try {
    world.config = await loadSiteConfig(world.root);
    world.errorConfig = '';
  } catch (e) {
    world.config = null;
    world.errorConfig = (e as Error).message;
  } finally {
    world.stderr = espia.mock.calls.map((c) => String(c[0])).join('');
    espia.mockRestore();
  }
});

When('cargo la configuración si existe', async () => {
  world.configOpcional = await loadSiteConfigIfPresent(world.root);
  world.config = world.configOpcional;
});

When('cargo la configuración con el conjunto de presencia', async () => {
  try {
    const { config, presentKeys } = await loadSiteConfigWithPresence(world.root);
    world.config = config;
    world.presentes = presentKeys;
    world.errorConfig = '';
  } catch (e) {
    world.config = null;
    world.presentes = new Set<string>();
    world.errorConfig = (e as Error).message;
  }
});

Then('la carga no falla', () => {
  if (world.errorConfig) throw new Error(`la carga falló: ${world.errorConfig}`);
});

Then('la carga falla diciendo que:', (motivo: string) => {
  if (!world.errorConfig) throw new Error('la carga no falló y debía');
  // El mensaje se compara por Trozos: los errores de tipo vienen en listas y
  // el orden de las claves depende del YAML que escribió el autor.
  const esperado = motivo.trim();
  if (!world.errorConfig.includes(esperado)) {
    throw new Error(`el error no dice ${JSON.stringify(esperado)}. Dijo: ${world.errorConfig}`);
  }
});

Then('la carga falla con {string}', (motivo: string) => {
  if (!world.errorConfig) throw new Error('la carga no falló y debía');
  if (!world.errorConfig.includes(motivo)) {
    throw new Error(`el error no dice ${JSON.stringify(motivo)}. Dijo: ${world.errorConfig}`);
  }
});

Then('no hay archivo de configuración', () => {
  if (world.configOpcional !== null) {
    throw new Error(`sin archivo de configuración esto debería ser null y fue ${JSON.stringify(world.configOpcional)}`);
  }
});

/**
 * Un paso para escalar y para lista porque el `Examples` no puede cambiar de
 * paso por fila: cucumber no tiene un tipo que acepte `true` y `["a","b"]` en
 * el mismo parámetro. La lista se compara unida por comas, que es lo que se
 * lee en la tabla.
 *
 * Se compara como texto para que un booleano no se confunda con la cadena
 * "true" — que es justo el error de tipo que este loader tiene que cazar.
 */
Then('la configuración tiene {string} con el valor {string}', (ruta: string, valor: string) => {
  const leido = en(world.config, ruta);
  const comoLista = Array.isArray(leido) ? leido.join(', ') : undefined;
  if (String(leido) !== valor && comoLista !== valor) {
    throw new Error(`${ruta} vale ${JSON.stringify(leido)} y el archivo dice ${JSON.stringify(valor)}`);
  }
});

Then('la configuración deja {string} sin materializar', (ruta: string) => {
  const leido = en(world.config, ruta);
  if (leido !== undefined) {
    throw new Error(`${ruta} se materializó a ${JSON.stringify(leido)} y debía quedar sin definir`);
  }
});

Then('la configuración avisa que {string}', (motivo: string) => {
  if (!world.stderr.includes(motivo)) {
    throw new Error(`el loader no avisó ${JSON.stringify(motivo)}. stderr: ${JSON.stringify(world.stderr)}`);
  }
});

Then('la carga no avisa nada', () => {
  if (world.stderr.includes('⚠')) {
    throw new Error(`una configuración válida produjo un aviso: ${JSON.stringify(world.stderr)}`);
  }
});

Then('la clave {string} está en el conjunto de presencia', (ruta: string) => {
  if (!world.presentes.has(ruta)) {
    throw new Error(`${ruta} no está en el conjunto de presencia: ${JSON.stringify([...world.presentes])}`);
  }
});

Then('la clave {string} NO está en el conjunto de presencia', (ruta: string) => {
  if (world.presentes.has(ruta)) {
    throw new Error(`${ruta} sí está en el conjunto de presencia y no debía`);
  }
});

Then('el conjunto de presencia está vacío', () => {
  if (world.presentes.size !== 0) {
    throw new Error(`esperaba cero claves presentes y hay ${JSON.stringify([...world.presentes])}`);
  }
});
