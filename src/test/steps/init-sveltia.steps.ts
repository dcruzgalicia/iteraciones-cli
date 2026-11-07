import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Then } from '@cucumber/cucumber';
import { parse } from 'yaml';
import { world } from './cli-world.steps.js';

interface Campo {
  name?: string;
  options?: Array<string | { value?: string }>;
}

interface Coleccion {
  name?: string;
  folder?: string;
  fields?: Campo[];
  files?: Array<{ file?: string; fields?: Campo[] }>;
}

interface ConfigSveltia {
  backend?: { name?: string };
  collections?: Coleccion[];
}

function config(): ConfigSveltia {
  return parse(readFileSync(join(world.root, 'admin', 'config.yml'), 'utf8')) as ConfigSveltia;
}

function paquete(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(world.root, 'package.json'), 'utf8')) as Record<string, unknown>;
}

function dependencias(pkg: Record<string, unknown>): Record<string, string> {
  return {
    ...((pkg.dependencies as Record<string, string> | undefined) ?? {}),
    ...((pkg.devDependencies as Record<string, string> | undefined) ?? {}),
  };
}

function camposDe(col: Coleccion): Campo[] {
  return [...(col.fields ?? []), ...(col.files ?? []).flatMap((file) => file.fields ?? [])];
}

Then('la configuración de Sveltia usa el backend {string}', (nombre: string) => {
  if (config().backend?.name !== nombre) {
    throw new Error(`el backend es ${JSON.stringify(config().backend?.name)} y debía ser ${JSON.stringify(nombre)}`);
  }
});

Then('la configuración de Sveltia declara la colección {string} en la carpeta {string}', (nombre: string, carpeta: string) => {
  const col = config().collections?.find((c) => c.name === nombre);
  if (col === undefined) throw new Error(`no existe la colección ${JSON.stringify(nombre)}`);
  if (col.folder !== carpeta)
    throw new Error(`la colección ${nombre} usa folder=${JSON.stringify(col.folder)} y debía ser ${JSON.stringify(carpeta)}`);
});

Then('la configuración de Sveltia declara el archivo {string}', (archivo: string) => {
  const hay = config().collections?.some((c) => (c.files ?? []).some((file) => file.file === archivo)) === true;
  if (!hay) throw new Error(`ninguna colección de archivos declara ${JSON.stringify(archivo)}`);
});

Then('la configuración de Sveltia declara el campo {string} en la colección {string}', (campo: string, coleccion: string) => {
  const col = config().collections?.find((c) => c.name === coleccion);
  if (col === undefined) throw new Error(`no existe la colección ${JSON.stringify(coleccion)}`);
  if (!camposDe(col).some((f) => f.name === campo)) {
    throw new Error(`la colección ${coleccion} no declara el campo ${JSON.stringify(campo)}`);
  }
});

Then('la configuración de Sveltia ofrece la licencia {string}', (licencia: string) => {
  const valores = (config().collections ?? [])
    .flatMap((col) => camposDe(col))
    .filter((campo) => campo.name === 'license')
    .flatMap((campo) => campo.options ?? [])
    .map((opcion) => (typeof opcion === 'string' ? opcion : (opcion.value ?? '')));
  if (!valores.includes(licencia)) throw new Error(`la licencia ${JSON.stringify(licencia)} no está entre ${JSON.stringify(valores)}`);
});

Then('el paquete declara el script {string}', (nombre: string) => {
  const scripts = (paquete().scripts as Record<string, string> | undefined) ?? {};
  if (scripts[nombre] === undefined) throw new Error(`package.json no declara el script ${JSON.stringify(nombre)}`);
});

Then('el paquete conserva el script {string}', (nombre: string) => {
  const scripts = (paquete().scripts as Record<string, string> | undefined) ?? {};
  if (scripts[nombre] === undefined) throw new Error(`package.json perdió el script ${JSON.stringify(nombre)}`);
});

Then('el paquete declara la dependencia {string}', (nombre: string) => {
  if (dependencias(paquete())[nombre] === undefined) throw new Error(`package.json no declara la dependencia ${JSON.stringify(nombre)}`);
});

Then('el paquete conserva la dependencia {string}', (nombre: string) => {
  if (dependencias(paquete())[nombre] === undefined) throw new Error(`package.json perdió la dependencia ${JSON.stringify(nombre)}`);
});

function dist(relativa: string): string {
  return join(world.root, 'dist', 'files', relativa);
}

Then('el sitio generado tiene el archivo {string}', (relativa: string) => {
  if (!existsSync(dist(relativa))) throw new Error(`dist/files no tiene ${JSON.stringify(relativa)}`);
});

Then('el sitio generado no tiene el archivo {string}', (relativa: string) => {
  if (existsSync(dist(relativa))) throw new Error(`dist/files sí tiene ${JSON.stringify(relativa)} y no debería`);
});

Then('el sitio generado tiene {string} con {string}', (relativa: string, texto: string) => {
  const contenido = readFileSync(dist(relativa), 'utf8');
  if (!contenido.includes(texto)) throw new Error(`${relativa} no contiene ${JSON.stringify(texto)}`);
});
