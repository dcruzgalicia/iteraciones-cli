import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Given, Then, When } from '@cucumber/cucumber';
import { parse as parseYaml } from 'yaml';
import { runBuild, runNew, runValidate } from '../../cli/dispatcher.js';
import { capture, world } from './cli-world.steps.js';

/**
 * #2546 (onda 2) — tranche 3 de `cli-layer`: `new` y la inferencia del título.
 *
 * ## Los títulos de la tabla están medidos, no calculados
 *
 * La feature dice qué título produce cada nombre de archivo. Esos valores
 * salieron de correr `runNew` y leer el `frontmatter` resultante. Escribirlos a
 * mano habría sido inventar el comportamiento en lugar de documentarlo — y la
 * capitalización por palabra ("Año Nuevo", no "Año-nuevo") es justo el detalle
 * que no se deduce leyendo el nombre.
 *
 * ## El frontmatter se lee como bloque, no como texto
 *
 * `el archivo X tiene el título Y` saca el bloque entre los dos `---` y busca
 * la clave adentro. Si se leyera el archivo entero, un `title:` en el cuerpo
 * del documento —los ejemplos del lenguaje son Markdown, pueden traer
 * frontmatter de ejemplo— haría pasar el test sin que el frontmatter real
 * estuviera bien.
 */

Given('que la raíz del proyecto está vacía', async () => {
  world.root = await mkdtemp(join(tmpdir(), 'iteraciones-cli-new-'));
});

Given('que la raíz del proyecto tiene una configuración mínima', async () => {
  // #2071: `validate` y `build` exigen `iteraciones.config.yaml`.
  world.root = await mkdtemp(join(tmpdir(), 'iteraciones-cli-new-'));
  await writeFile(join(world.root, 'iteraciones.config.yaml'), 'language: es-MX\n', 'utf8');
});

When('creo el documento {string}', async (argumento: string) => {
  await capture(() => runNew(world.root, argumento));
});

When('creo el documento {string} con el título {string}', async (argumento: string, titulo: string) => {
  await capture(() => runNew(world.root, argumento, { title: titulo }));
});

// El título con comillas dobles vive acá y no en un `{string}` del feature:
// `check-steps` sólo reconoce cadenas entre comillas dobles, así que un valor
// con `"` dentro no puede pasar por un parámetro de tabla sin romper el
// inventario de pasos. El feature lo nombra en el nombre del escenario.
const TITULO_CON_COMILLAS = 'El "jardín" de las delicias';

When('creo el documento {string} con un título con comillas', async (argumento: string) => {
  await capture(() => runNew(world.root, argumento, { title: TITULO_CON_COMILLAS }));
});

When('valido el proyecto que acabo de crear', async () => {
  await capture(() => runValidate(world.root));
});

When('construyo el proyecto', async () => {
  await capture(() => runBuild(world.root));
});

/** El bloque YAML inicial: lo que hay entre el primer y el segundo `---`. */
function frontmatter(contenido: string): string {
  const partes = contenido.split('---');
  return partes.length > 1 ? (partes[1] ?? '') : '';
}

async function archivo(nombre: string): Promise<string> {
  return await Bun.file(join(world.root, nombre)).text();
}

/** El `frontmatter` parseado. Tira si el YAML no es válido, que es el punto. */
async function frontmatterParseado(nombre: string): Promise<Record<string, unknown>> {
  const crudo = frontmatter(await archivo(nombre));
  const datos = parseYaml(crudo);
  if (datos === null || typeof datos !== 'object') {
    throw new Error(`el frontmatter de ${nombre} no es un mapa:\n${crudo.trim()}`);
  }
  return datos as Record<string, unknown>;
}

Then('el archivo {string} existe', async (nombre: string) => {
  if (!(await Bun.file(join(world.root, nombre)).exists())) {
    throw new Error(`no se creó ${nombre} en ${world.root}`);
  }
});

Then('el archivo {string} no existe', async (nombre: string) => {
  if (await Bun.file(join(world.root, nombre)).exists()) {
    throw new Error(`${nombre} no debería existir en ${world.root}`);
  }
});

Then('el frontmatter de {string} declara el título {string}', async (nombre: string, titulo: string) => {
  // Se PARSEA el YAML y se compara el valor, no la línea escrita. Comparar la
  // línea metería el estilo de comillas de la librería adentro de la regla de
  // negocio: un refactor inocuo de `yaml` rompería estos escenarios sin que el
  // CLI hubiera cambiado. Y si el escape está roto, `parseYaml` tira acá.
  const datos = await frontmatterParseado(nombre);
  if (datos.title !== titulo) {
    throw new Error(`el frontmatter de ${nombre} declara title=${JSON.stringify(datos.title)} y debía declarar ${JSON.stringify(titulo)}`);
  }
});

Then('el frontmatter de {string} declara ese título con comillas', async (nombre: string) => {
  const datos = await frontmatterParseado(nombre);
  if (datos.title !== TITULO_CON_COMILLAS) {
    throw new Error(
      `el frontmatter de ${nombre} declara title=${JSON.stringify(datos.title)} y debía declarar ${JSON.stringify(TITULO_CON_COMILLAS)}`,
    );
  }
});

Then('el archivo {string} tiene la clave {string}', async (nombre: string, clave: string) => {
  const yaml = frontmatter(await archivo(nombre));
  if (!new RegExp(`^${clave}`, 'm').test(yaml)) {
    throw new Error(`el frontmatter de ${nombre} no tiene ${clave}. Va:\n${yaml.trim()}`);
  }
});

Then('el archivo {string} contiene {string}', async (nombre: string, texto: string) => {
  if (!(await archivo(nombre)).includes(texto)) {
    throw new Error(`${nombre} no contiene ${JSON.stringify(texto)}`);
  }
});

Then('el frontmatter de {string} no menciona {string}', async (nombre: string, texto: string) => {
  const yaml = frontmatter(await archivo(nombre));
  if (yaml.includes(texto)) {
    throw new Error(`el frontmatter de ${nombre} menciona ${JSON.stringify(texto)} y no debería:\n${yaml.trim()}`);
  }
});
