import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Then } from '@cucumber/cucumber';
import { parse } from 'yaml';
import { distPath } from '../helpers.js';
import { world } from './cli-world.steps.js';

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
  path?: string;
  preview_path?: string;
  media_folder?: string;
  public_folder?: string;
  filter?: { field?: string; value?: unknown };
  nested?: { depth?: number; subfolders?: boolean };
  meta?: { path?: { index_file?: string } };
  editor?: { preview?: boolean };
  fields?: Campo[];
  files?: Array<{ file?: string; fields?: Campo[] }>;
}

interface ConfigSveltia {
  backend?: { name?: string; repo?: string; branch?: string; auth_type?: string; app_id?: string; open_authoring?: boolean };
  site_url?: string;
  display_url?: string;
  media_folder?: string;
  public_folder?: string;
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

Then('todas las colecciones comparten el directorio de medios {string} con la URL {string}', (media: string, url: string) => {
  const c = config();
  if (c.media_folder !== media) throw new Error(`media_folder es ${JSON.stringify(c.media_folder)} y debía ser ${JSON.stringify(media)}`);
  if (c.public_folder !== url) throw new Error(`public_folder es ${JSON.stringify(c.public_folder)} y debía ser ${JSON.stringify(url)}`);
  for (const col of c.collections ?? []) {
    if (col.media_folder !== undefined || col.public_folder !== undefined) {
      throw new Error(`la colección ${JSON.stringify(col.name)} redefine media_folder/public_folder y no debería`);
    }
  }
});

Then('la configuración de Sveltia declara la colección {string} en la carpeta {string}', (nombre: string, carpeta: string) => {
  const col = config().collections?.find((c) => c.name === nombre);
  if (col === undefined) throw new Error(`no existe la colección ${JSON.stringify(nombre)}`);
  if (col.folder !== carpeta)
    throw new Error(`la colección ${nombre} usa folder=${JSON.stringify(col.folder)} y debía ser ${JSON.stringify(carpeta)}`);
});

Then('la configuración de Sveltia no declara la colección {string}', (nombre: string) => {
  if (config().collections?.some((c) => c.name === nombre) === true) throw new Error(`la colección ${JSON.stringify(nombre)} no debería existir`);
});

Then('la colección {string} usa la ruta {string}', (nombre: string, ruta: string) => {
  const actual = coleccion(nombre).path;
  if (actual !== ruta) throw new Error(`la colección ${nombre} usa path=${JSON.stringify(actual)} y debía ser ${JSON.stringify(ruta)}`);
});

Then('la colección {string} anida con profundidad {int} sin subcarpetas', (nombre: string, profundidad: number) => {
  const nested = coleccion(nombre).nested;
  if (nested?.depth !== profundidad || nested.subfolders !== false) {
    throw new Error(`la colección ${nombre} anida con ${JSON.stringify(nested)} y debía ser depth=${profundidad} sin subcarpetas`);
  }
});

Then('la colección {string} anida con profundidad {int} con subcarpetas', (nombre: string, profundidad: number) => {
  const nested = coleccion(nombre).nested;
  if (nested?.depth !== profundidad || nested.subfolders !== true) {
    throw new Error(`la colección ${nombre} anida con ${JSON.stringify(nested)} y debía ser depth=${profundidad} con subcarpetas`);
  }
});

Then('la colección {string} filtra el campo {string} con el valor {string}', (nombre: string, campo: string, valor: string) => {
  const filter = coleccion(nombre).filter;
  if (filter?.field !== campo || filter.value !== valor) {
    throw new Error(`la colección ${nombre} filtra con ${JSON.stringify(filter)} y debía ser ${campo}=${valor}`);
  }
});

Then('la colección {string} no usa meta.path', (nombre: string) => {
  if (coleccion(nombre).meta?.path !== undefined) throw new Error(`la colección ${nombre} no debería declarar meta.path`);
});

Then('la colección {string} usa el archivo índice {string}', (nombre: string, indice: string) => {
  const actual = coleccion(nombre).meta?.path?.index_file;
  if (actual !== indice) throw new Error(`la colección ${nombre} usa index_file=${JSON.stringify(actual)} y debía ser ${JSON.stringify(indice)}`);
});

Then('la colección {string} tiene el preview path {string}', (nombre: string, preview: string) => {
  const actual = coleccion(nombre).preview_path;
  if (actual !== preview) throw new Error(`la colección ${nombre} usa preview_path=${JSON.stringify(actual)} y debía ser ${JSON.stringify(preview)}`);
});

Then('la colección {string} no tiene preview', (nombre: string) => {
  if (coleccion(nombre).editor?.preview !== false) throw new Error(`la colección ${nombre} no debería tener preview`);
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

Then('la configuración de Sveltia usa autenticación PKCE', () => {
  const backend = config().backend;
  if (backend?.auth_type !== 'pkce' || backend.app_id === undefined || backend.app_id === '') {
    throw new Error(`la autenticación no es PKCE: ${JSON.stringify({ auth_type: backend?.auth_type, app_id: backend?.app_id })}`);
  }
});

Then('la configuración de Sveltia usa la URL {string}', (url: string) => {
  const c = config();
  if (c.site_url !== url || c.display_url !== url) {
    throw new Error(`site_url=${JSON.stringify(c.site_url)} y display_url=${JSON.stringify(c.display_url)}; debían ser ${JSON.stringify(url)}`);
  }
});

Then('la configuración de Sveltia habilita open authoring', () => {
  if (config().backend?.open_authoring !== true) throw new Error('open_authoring no está habilitado');
});

Then('la configuración de Sveltia no habilita open authoring', () => {
  if (config().backend?.open_authoring !== undefined) throw new Error('open_authoring no debería estar habilitado');
});

Then('el paquete declara la dependencia {string} con el valor {string}', (nombre: string, valor: string) => {
  const actual = dependencias(paquete())[nombre];
  if (actual !== valor) throw new Error(`la dependencia ${nombre} vale ${JSON.stringify(actual)} y debía ser ${JSON.stringify(valor)}`);
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
