import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Given, Then } from '@cucumber/cucumber';
import { parse } from 'yaml';
import { distPath } from '../helpers.js';
import { tempRoot, world } from './cli-world.steps.js';

interface Campo {
  name?: string;
  label?: string;
  widget?: string;
  collection?: string;
  value_field?: string;
  multiple?: boolean;
  required?: boolean;
  default?: unknown;
  preview?: boolean;
  dropdown_threshold?: number;
  options?: Array<string | { value?: string }>;
}

interface Coleccion {
  name?: string;
  folder?: string;
  fields?: Campo[];
  files?: Array<{ file?: string; fields?: Campo[] }>;
}

interface ConfigSveltia {
  backend?: { name?: string; repo?: string; branch?: string; site_domain?: string };
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

Then('el sitio generado tiene el archivo {string}', (relativa: string) => {
  if (!existsSync(distPath(world.root, relativa))) throw new Error(`dist/files no tiene ${JSON.stringify(relativa)}`);
});

Then('el sitio generado no tiene el archivo {string}', (relativa: string) => {
  if (existsSync(distPath(world.root, relativa))) throw new Error(`dist/files sí tiene ${JSON.stringify(relativa)} y no debería`);
});

Then('el sitio generado tiene {string} con {string}', (relativa: string, texto: string) => {
  const contenido = readFileSync(distPath(world.root, relativa), 'utf8');
  if (!contenido.includes(texto)) throw new Error(`${relativa} no contiene ${JSON.stringify(texto)}`);
});

Then('el paquete no declara la dependencia {string}', (nombre: string) => {
  if (dependencias(paquete())[nombre] !== undefined) throw new Error(`package.json no debería declarar la dependencia ${JSON.stringify(nombre)}`);
});

function coleccion(nombre: string): Coleccion {
  const col = config().collections?.find((c) => c.name === nombre);
  if (col === undefined) throw new Error(`no existe la colección ${JSON.stringify(nombre)}`);
  return col;
}

function campoDe(nombre: string, col: string): Campo {
  const campo = camposDe(coleccion(col)).find((f) => f.name === nombre);
  if (campo === undefined) throw new Error(`la colección ${JSON.stringify(col)} no declara el campo ${JSON.stringify(nombre)}`);
  return campo;
}

Then('el campo {string} de la colección {string} es de tipo {string}', (nombre: string, col: string, widget: string) => {
  const campo = campoDe(nombre, col);
  if (campo.widget !== widget) throw new Error(`el campo ${nombre} usa widget=${JSON.stringify(campo.widget)} y debía ser ${JSON.stringify(widget)}`);
});

Then('el campo {string} de la colección {string} es una relación con {string}', (nombre: string, col: string, objetivo: string) => {
  const campo = campoDe(nombre, col);
  if (campo.widget !== 'relation' || campo.collection !== objetivo || campo.value_field !== 'name') {
    throw new Error(
      `el campo ${nombre} no es una relación con ${objetivo} por name: ${JSON.stringify({ widget: campo.widget, collection: campo.collection, value_field: campo.value_field })}`,
    );
  }
});

Then('el campo {string} de la colección {string} tiene la etiqueta {string}', (nombre: string, col: string, etiqueta: string) => {
  const campo = campoDe(nombre, col);
  if (campo.label !== etiqueta)
    throw new Error(`el campo ${nombre} tiene label=${JSON.stringify(campo.label)} y debía ser ${JSON.stringify(etiqueta)}`);
});

Then('el campo {string} de la colección {string} es obligatorio', (nombre: string, col: string) => {
  if (campoDe(nombre, col).required === false) throw new Error(`el campo ${nombre} no es obligatorio`);
});

Then('el campo {string} de la colección {string} no es obligatorio', (nombre: string, col: string) => {
  if (campoDe(nombre, col).required !== false) throw new Error(`el campo ${nombre} sí es obligatorio`);
});

Then('el campo {string} de la colección {string} está oculto con el valor {string}', (nombre: string, col: string, valor: string) => {
  const campo = campoDe(nombre, col);
  if (campo.widget !== 'hidden' || campo.default !== valor) {
    throw new Error(
      `el campo ${nombre} no está oculto con ${JSON.stringify(valor)}: ${JSON.stringify({ widget: campo.widget, default: campo.default })}`,
    );
  }
});

Then('la colección {string} tiene los campos {string}', (nombre: string, esperados: string) => {
  const nombres = camposDe(coleccion(nombre)).map((f) => f.name);
  const esperado = esperados.split(',').map((s) => s.trim());
  if (JSON.stringify(nombres) !== JSON.stringify(esperado)) {
    throw new Error(`los campos de ${nombre} son ${JSON.stringify(nombres)} y debían ser ${JSON.stringify(esperado)}`);
  }
});

Then('el archivo {string} menciona {string} una sola vez', (relativa: string, texto: string) => {
  const contenido = readFileSync(join(world.root, relativa), 'utf8');
  const veces = contenido.split(texto).length - 1;
  if (veces !== 1) throw new Error(`${relativa} menciona ${JSON.stringify(texto)} ${veces} veces y debía ser una`);
});

function git(cwd: string, args: string[]): void {
  const proc = Bun.spawnSync(['git', ...args], { cwd, stdout: 'ignore', stderr: 'ignore' });
  if (proc.exitCode !== 0) throw new Error(`git ${args.join(' ')} falló en ${cwd}`);
}

Given('el proyecto tiene un remoto de GitHub {string}', (url: string) => {
  git(world.root, ['init', '-b', 'main']);
  git(world.root, ['remote', 'add', 'origin', url]);
});

Given('el proyecto tiene un remoto de GitHub {string} en la rama {string}', (url: string, rama: string) => {
  git(world.root, ['init', '-b', rama]);
  git(world.root, ['remote', 'add', 'origin', url]);
});

Then('la configuración de Sveltia usa el repositorio {string}', (repo: string) => {
  if (config().backend?.repo !== repo) {
    throw new Error(`el repo es ${JSON.stringify(config().backend?.repo)} y debía ser ${JSON.stringify(repo)}`);
  }
});

Then('la configuración de Sveltia usa la rama {string}', (rama: string) => {
  if (config().backend?.branch !== rama) {
    throw new Error(`la rama es ${JSON.stringify(config().backend?.branch)} y debía ser ${JSON.stringify(rama)}`);
  }
});

Then('la configuración de Sveltia usa el dominio {string}', (dominio: string) => {
  if (config().backend?.site_domain !== dominio) {
    throw new Error(`el dominio es ${JSON.stringify(config().backend?.site_domain)} y debía ser ${JSON.stringify(dominio)}`);
  }
});

Then('el paquete declara la dependencia {string} con el valor {string}', (nombre: string, valor: string) => {
  const actual = dependencias(paquete())[nombre];
  if (actual !== valor) throw new Error(`la dependencia ${nombre} vale ${JSON.stringify(actual)} y debía ser ${JSON.stringify(valor)}`);
});

Given('que la raíz del proyecto se llama {string}', (nombre: string) => {
  world.root = join(tempRoot('iteraciones-cli-nombre-'), nombre);
  mkdirSync(world.root, { recursive: true });
});

Then('el campo {string} de la colección {string} no aparece en la vista previa', (nombre: string, col: string) => {
  if (campoDe(nombre, col).preview !== false) throw new Error(`el campo ${nombre} de ${col} sí aparece en la vista previa`);
});

Then('el campo {string} de la colección {string} no usa radio buttons ni checkboxes', (nombre: string, col: string) => {
  const campo = campoDe(nombre, col);
  if ((campo.widget !== 'relation' && campo.widget !== 'select') || campo.dropdown_threshold !== 0) {
    throw new Error(
      `el campo ${nombre} de ${col} no fuerza el desplegable: ${JSON.stringify({ widget: campo.widget, dropdown_threshold: campo.dropdown_threshold })}`,
    );
  }
});
