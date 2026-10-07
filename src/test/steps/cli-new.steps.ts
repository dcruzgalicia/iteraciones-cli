import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Given, Then, When } from '@cucumber/cucumber';
import { parse as parseYaml } from 'yaml';
import { runBuild, runNew, runValidate } from '../../cli/dispatcher.js';
import { capture, world } from './cli-world.steps.js';

Given('que la raíz del proyecto tiene una configuración mínima', async () => {
  world.root = await mkdtemp(join(tmpdir(), 'iteraciones-cli-new-'));
  await writeFile(join(world.root, 'iteraciones.config.yaml'), 'language: es-MX\n', 'utf8');
});

When('creo el documento {string}', async (argumento: string) => {
  await capture(() => runNew(world.root, argumento));
});

When('creo el documento {string} con el título {string}', async (argumento: string, titulo: string) => {
  await capture(() => runNew(world.root, argumento, { title: titulo }));
});

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

function frontmatter(contenido: string): string {
  const partes = contenido.split('---');
  return partes.length > 1 ? (partes[1] ?? '') : '';
}

async function archivo(nombre: string): Promise<string> {
  return await Bun.file(join(world.root, nombre)).text();
}

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
