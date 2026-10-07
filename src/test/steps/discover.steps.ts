import { Given, Then, When } from '@cucumber/cucumber';
import { buildDocsFromIndex, computeSlug, htmlSlugFor } from '../../builder/discover.js';
import { parseAuthors } from '../../builder/discover-frontmatter.js';
import type { DiscoveryEntry } from '../../builder/types.js';
import { parseYamlWithPosition, splitFrontmatter } from '../../lib/frontmatter.js';
import { world } from './cli-world.steps.ts';

/**
 * #2580 (onda 2) — el descubrimiento: cómo se llama y de dónde sale cada cosa.
 *
 * Los 38 casos de `discover.test.ts` son cuatro tablas: un título y sus
 * autores producen un nombre; una ruta produce un nombre de HTML; un autor
 * produce una lista; un archivo produce YAML y cuerpo. Casi ningún caso es
 * único, y por eso aquí hay pasos genéricos y features con `Examples`.
 *
 * ## El nombre del archivo es comportamiento, no un detalle
 *
 * `computeSlug` decide qué se llama `mi-articulo-por-sofia-garcia.pdf`. Que el
 * título se normalice sin acentos y que el autor se recorte al primero son
 * reglas que el autor ve en el nombre del PDF que descarga. Por eso los pasos
 * hablan de "el nombre de salida" y no de la función que lo calcula.
 *
 * ## El frontmatter devuelve el cuerpo con el salto que tenía
 *
 * `splitFrontmatter` devuelve `body` con el `\n` inicial que separa el cierre
 * del YAML. Eso no es un detalle: si el cuerpo volviera limpio, el primer
 * párrafo del autor pegaría al preámbulo y el PDF saldría con la sangría
 * corrida. Los `Examples` llevan el salto a propósito.
 */

/** El frontmatter del documento del escenario, tal como lo escribió el autor. */
function frontmatter(): { title?: string; creator?: string[] } {
  const fm: { title?: string; creator?: string[] } = {};
  if (world.titulo !== null) fm.title = world.titulo;
  if (world.creadores.length > 0) fm.creator = world.creadores;
  return fm;
}

Given('que el documento se titula {string}', (titulo: string) => {
  world.titulo = titulo;
  if (!world.creadores.length) world.titulo = titulo;
});

Given('que el documento no tiene título', () => {
  world.titulo = null;
});

Given('que el documento tiene de autor {string}', (autores: string) => {
  world.creadores = autores.split(',').map((a) => a.trim());
});

/**
 * El `creator` del frontmatter puede venir como string suelto, como lista, o
 * no venir. Los tres llegan desde `parseAuthors`, y los tres escriben lo
 * mismo en el index, así que el `Given` los acepta igual.
 */
Given('que el frontmatter declara el autor como:', (declarado: string) => {
  // El `creator` llega como texto suelto o como lista YAML, y un docstring no
  // distingue uno de otro. Se parsea como JSON y, si no es JSON, se toma tal
  // cual: las dos formas escriben lo mismo en el index.
  const texto = declarado.trim();
  try {
    world.autorDeclarado = texto === '' ? undefined : JSON.parse(texto);
  } catch {
    world.autorDeclarado = texto;
  }
});

Given('que el documento viene del archivo {string}', (ruta: string) => {
  world.fallback = ruta;
});

Given('que el nombre admite hasta {int} autores', (cuantos: number) => {
  world.maxCreadores = cuantos;
});

Given('que el archivo del documento es {string}', (ruta: string) => {
  world.rutaArchivo = ruta;
});

Given('que el nombre ya calculado es {string}', (nombre: string) => {
  world.nombrePrevio = nombre;
});

Given('que no hay nombre calculado', () => {
  world.nombrePrevio = undefined;
});

/**
 * El archivo del escenario, con los saltos que pida.
 *
 * Las tablas de `Ejemplos` son de una línea por celda, y un frontmatter son
 * tres. `<br>` es el salto de línea dentro de una celda: se traduce a `
`
 * aquí. La alternativa —un escenario con docstring por fila— duplica el
 * escenario ocho veces y la tabla de causas deja de poder leerse de un tirón.
 */
Given('que el archivo tiene este texto:', (texto: string) => {
  world.texto = texto.replace(/<br>/g, '\n').replace(/\\r\\n/g, '\r\n');
});

Given('que el archivo tiene saltos CRLF y este texto:', (texto: string) => {
  world.texto = texto.replace(/<br>/g, '\n').replace(/\\r\\n|\n/g, '\r\n');
});

When('calculo el nombre del archivo de salida', () => {
  world.nombre = computeSlug(frontmatter(), {
    maxCreators: world.maxCreadores,
    fallbackPath: world.fallback,
  });
});

When('calculo el nombre del HTML', () => {
  world.nombre = htmlSlugFor(world.rutaArchivo, world.nombrePrevio);
});

When('construyo los documentos desde el índice', () => {
  // Sin entradas: el build tiene que construir el documento igual, con lo que
  // el index no sabe. Un archivo sin index no es un archivo que se salta.
  const index = new Map<string, DiscoveryEntry>();
  world.documentos = buildDocsFromIndex(world.rutasIndex, index, world.raizRaiz || '/proyecto');
});

When('separo el autor en una lista', () => {
  world.listaAutores = parseAuthors(world.autorDeclarado as Parameters<typeof parseAuthors>[0]);
});

Given('que el índice tiene una entrada para {string}', (ruta: string) => {
  world.rutasIndex = ruta.split(',').map((r) => r.trim());
});

Given('que la raíz del proyecto es {string}', (raiz: string) => {
  world.raizRaiz = raiz;
});

When('construyo los documentos desde el índice:', (indice: string) => {
  const entradas = JSON.parse(indice) as Record<string, { title?: string; creator?: string[] }>;
  const index = new Map(Object.entries(entradas)) as Map<string, DiscoveryEntry>;
  // `world.rutasIndex` manda: es lo que dice qué archivos existen, y las
  // entradas del JSON sólo qué se sabe de ellos. Así un archivo sin entrada se
  // construye igual, con los valores por defecto.
  const paths = world.rutasIndex.length > 0 ? world.rutasIndex : Object.keys(entradas);
  world.documentos = buildDocsFromIndex(paths, index, world.raizRaiz || '/proyecto');
});

When('separo el frontmatter del cuerpo', () => {
  const { yaml, body } = splitFrontmatter(world.texto);
  world.yaml = yaml;
  world.cuerpo = body;
});

When('parseo el YAML con posición', () => {
  world.parseo = parseYamlWithPosition(world.texto);
});

Then('el nombre de salida es {string}', (esperado: string) => {
  if (world.nombre !== esperado) {
    throw new Error(`el nombre es ${JSON.stringify(world.nombre)} y debería ser ${JSON.stringify(esperado)}`);
  }
});

Then('el nombre de salida no existe', () => {
  if (world.nombre !== undefined) {
    throw new Error(`sin título ni archivo de reserva no hay nombre, y salió ${JSON.stringify(world.nombre)}`);
  }
});

Then('la lista de autores es {string}', (esperada: string) => {
  const leida = world.listaAutores.join(', ');
  if (leida !== esperada) {
    throw new Error(`los autores son ${JSON.stringify(leida)} y deberían ser ${JSON.stringify(esperada)}`);
  }
});

Then('la lista de autores está vacía', () => {
  if (world.listaAutores.length > 0) {
    throw new Error(`esperaba sin autores y hay ${JSON.stringify(world.listaAutores)}`);
  }
});

/** `<br>` es el salto de línea de una celda de `Ejemplos`. Ver el `Given` de arriba. */
const sinCeldas = (celda: string): string => celda.replace(/<br>/g, '\n').replace(/\\r\\n/g, '\r\n');

Then('el cuerpo separado es:', (esperado: string) => {
  if (world.cuerpo !== sinCeldas(esperado)) {
    throw new Error(`el cuerpo es ${JSON.stringify(world.cuerpo)} y debería ser ${JSON.stringify(esperado)}`);
  }
});

Then('hay {int} documentos', (cuantos: number) => {
  if (world.documentos.length !== cuantos) {
    throw new Error(`hay ${world.documentos.length} documentos y son ${cuantos}`);
  }
});

Then('el documento {int} tiene el título {string}', (cual: number, titulo: string) => {
  const doc = world.documentos[cual - 1];
  if (doc?.frontmatter.title !== titulo) {
    throw new Error(`el documento ${cual} titula ${JSON.stringify(doc?.frontmatter.title)} y debería ser ${JSON.stringify(titulo)}`);
  }
});

Then('el documento {int} tiene de autor {string}', (cual: number, autores: string) => {
  const leidos = (world.documentos[cual - 1]?.frontmatter.creator ?? []).join(', ');
  if (leidos !== autores) {
    throw new Error(`el documento ${cual} tiene de autor ${JSON.stringify(leidos)} y debería ser ${JSON.stringify(autores)}`);
  }
});

Then('el documento {int} no tiene autor', (cual: number) => {
  const creators = world.documentos[cual - 1]?.frontmatter.creator ?? [];
  if (creators.length > 0) throw new Error(`esperaba sin autor y hay ${JSON.stringify(creators)}`);
});

Then('el documento {int} tiene la fecha {string}', (cual: number, fecha: string) => {
  const leida = String(world.documentos[cual - 1]?.frontmatter.date);
  if (leida !== fecha) throw new Error(`la fecha es ${JSON.stringify(leida)} y debería ser ${JSON.stringify(fecha)}`);
});

Then('el documento {int} está en {string}', (cual: number, ruta: string) => {
  const doc = world.documentos[cual - 1];
  if (doc?.relativePath !== ruta) {
    throw new Error(`el documento ${cual} está en ${JSON.stringify(doc?.relativePath)} y debería estar en ${JSON.stringify(ruta)}`);
  }
});

Then('el documento {int} se lee de {string}', (cual: number, ruta: string) => {
  const doc = world.documentos[cual - 1];
  if (doc?.filePath !== ruta) {
    throw new Error(`el documento ${cual} se lee de ${JSON.stringify(doc?.filePath)} y debería leerse de ${JSON.stringify(ruta)}`);
  }
});

Then('el YAML se parsea a:', (esperado: string) => {
  const leido = JSON.stringify(world.parseo.value);
  if (leido !== sinCeldas(esperado)) {
    throw new Error(`el valor parseado es ${leido} y debería ser ${esperado}`);
  }
});

Then('el YAML no se parsea', () => {
  if (world.parseo.value !== undefined) {
    throw new Error(`el YAML se parseó a ${JSON.stringify(world.parseo.value)} y no debía`);
  }
});

Then('el error del YAML no está', () => {
  if (world.parseo.error !== undefined) {
    throw new Error(`el YAML es válido y aun así falló: ${world.parseo.error}`);
  }
});

Then('el error del YAML dice {string}', (motivo: string) => {
  if (!world.parseo.error) throw new Error('el YAML no falló y debía');
  if (!world.parseo.error.includes(motivo)) {
    throw new Error(`el error no dice ${JSON.stringify(motivo)}. Dijo: ${world.parseo.error}`);
  }
});

/**
 * El error tiene que caber en una línea. La librería de YAML mete su snippet y
 * su caret en varias, y el logger del CLI lo imprime dentro de una línea de
 * bullet: el resto se corta o se pierde.
 */
Then('el error del YAML cabe en una sola línea', () => {
  const error = world.parseo.error;
  if (error === undefined) throw new Error('el YAML no falló y debía');
  if (error.includes('\n')) throw new Error(`el error ocupa varias líneas: ${JSON.stringify(error)}`);
  if (!/\(línea \d+, columna \d+\)$/.test(error)) {
    throw new Error(`el error no termina con línea y columna: ${JSON.stringify(error)}`);
  }
  // La posición de la librería no se duplica: "at line" es un resto del parser.
  if (error.includes('at line')) throw new Error(`el error repite la posición: ${JSON.stringify(error)}`);
});

/** Escapar el cuerpo en una tabla de `Examples` es ilegible; va en docstring. */
/**
 * Las mismas dos aserciones en forma `{string}` para las tablas de `Examples`,
 * donde no cabe un docstring. Dos formas y no una porque cucumber no las
 * mezcla: el docstring llega como argumento y el `{string}` como texto.
 */
Then('el YAML separado es {string}', (esperado: string) => {
  // `sin YAML` es el centinela de la tabla para "este archivo no tenía
  // frontmatter"; el resto se compara como texto, que es lo que se ve.
  const quiere = sinCeldas(esperado);
  if (quiere === 'sin YAML') {
    if (world.yaml !== undefined) throw new Error(`el archivo no tiene frontmatter y salió ${JSON.stringify(world.yaml)}`);
    return;
  }
  if (world.yaml !== quiere) {
    throw new Error(`el YAML es ${JSON.stringify(world.yaml)} y debería ser ${JSON.stringify(quiere)}`);
  }
});

Then('el cuerpo separado es {string}', (esperado: string) => {
  if (world.cuerpo !== sinCeldas(esperado)) {
    throw new Error(`el cuerpo es ${JSON.stringify(world.cuerpo)} y debería ser ${JSON.stringify(esperado)}`);
  }
});
