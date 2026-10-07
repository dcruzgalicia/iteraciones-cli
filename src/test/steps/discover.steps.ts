import { Given, Then, When } from '@cucumber/cucumber';
import { buildDocsFromIndex, computeSlug, htmlSlugFor } from '../../builder/discover.js';
import { parseAuthors } from '../../builder/discover-frontmatter.js';
import type { DiscoveryEntry } from '../../builder/types.js';
import { parseYamlWithPosition, splitFrontmatter } from '../../lib/frontmatter.js';
import { world } from './cli-world.steps.ts';

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

Given('que el frontmatter declara el autor como:', (declarado: string) => {
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

Then('el error del YAML cabe en una sola línea', () => {
  const error = world.parseo.error;
  if (error === undefined) throw new Error('el YAML no falló y debía');
  if (error.includes('\n')) throw new Error(`el error ocupa varias líneas: ${JSON.stringify(error)}`);
  if (!/\(línea \d+, columna \d+\)$/.test(error)) {
    throw new Error(`el error no termina con línea y columna: ${JSON.stringify(error)}`);
  }

  if (error.includes('at line')) throw new Error(`el error repite la posición: ${JSON.stringify(error)}`);
});

Then('el YAML separado es {string}', (esperado: string) => {
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
