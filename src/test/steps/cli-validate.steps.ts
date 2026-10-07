import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Given, Then, When } from '@cucumber/cucumber';
import { buildProgram } from '../../cli/parser.js';
import { capture, jsonSalida, raiz, world } from './cli-world.steps.js';

function lista(clave: string): Record<string, unknown>[] {
  const valor = jsonSalida()[clave];
  if (!Array.isArray(valor)) {
    throw new Error(`la clave ${JSON.stringify(clave)} del JSON no es una lista: ${JSON.stringify(valor)}`);
  }
  return valor as Record<string, unknown>[];
}

function escribir(ruta: string, contenido: string): void {
  mkdirSync(dirname(ruta), { recursive: true });
  writeFileSync(ruta, contenido, 'utf8');
}

Given('que la raíz del proyecto tiene un documento pero no la configuración', async () => {
  world.root = await mkdtemp(join(tmpdir(), 'iteraciones-cli-validate-'));
  escribir(join(world.root, 'doc.md'), '---\ntitle: Doc\ndate: 2026-01-01\n---\n\nTexto.\n');
});

Given('que el archivo {string} tiene este contenido', (ruta: string, contenido: string) => {
  escribir(join(world.root, ruta), contenido);
});

Given('que el archivo {string} tiene el contenido {string}', (ruta: string, contenido: string) => {
  escribir(join(world.root, ruta), contenido);
});

Given('que el archivo {string} está vacío', (ruta: string) => {
  escribir(join(world.root, ruta), '');
});

Given('que el documento {string} tiene el frontmatter {string}', (ruta: string, frontmatter: string) => {
  escribir(join(world.root, ruta), `---\n${frontmatter}\n---\n\n# Hola\n`);
});

Given('que el documento {string} tiene el frontmatter sin cerrar', (ruta: string) => {
  escribir(join(world.root, ruta), '---\ntitle: "sin cerrar\n---\n\nContenido.\n');
});

Given('que el documento {string} declara varios campos efectivos', (ruta: string) => {
  escribir(
    join(world.root, ruta),
    [
      '---',
      'title: Efectivos',
      'language: en',
      'toc: true',
      'description: Resumen',
      'site-title: Mi sitio',
      'theme: light',
      'accent: rose',
      '---',
      '',
      'Contenido.',
      '',
    ].join('\n'),
  );
});

Given('que la configuración declara la clave {string} con el valor {string}', (clave: string, valor: string) => {
  escribir(join(world.root, 'iteraciones.config.yaml'), `language: es-MX\n${clave}: ${valor}\n`);
});

Given('que la configuración desactiva un filtro global {string}', (filtro: string) => {
  raiz();
  escribir(join(world.root, 'iteraciones.config.yaml'), `language: es-MX\nformat:\n  html:\n    generate: true\ndisabledFilters:\n  - ${filtro}\n`);
});

Given('que la configuración desactiva un filtro del preámbulo {string}', (filtro: string) => {
  escribir(join(world.root, 'iteraciones.config.yaml'), `language: es-MX\nformat:\n  pdf:\n    disabledPreambleFilters:\n      - ${filtro}\n`);
});

When('valido el proyecto pidiendo JSON', async () => {
  await capture(async () => {
    try {
      await buildProgram().parseAsync(['bun', 'bin.ts', 'validate', '--json', '--project-root', world.root]);
    } catch (err) {
      process.exitCode = 1;
      throw err;
    }
  });
});

Then('el JSON declara la clave {string} con el valor verdadero', (clave: string) => {
  if (jsonSalida()[clave] !== true) {
    throw new Error(`${JSON.stringify(clave)} no es true en el JSON: ${world.stdout}`);
  }
});

Then('el JSON declara la clave {string} con el valor falso', (clave: string) => {
  if (jsonSalida()[clave] !== false) {
    throw new Error(`${JSON.stringify(clave)} no es false en el JSON: ${world.stdout}`);
  }
});

Then('el JSON declara la clave {string} con el número {int}', (clave: string, numero: number) => {
  if (jsonSalida()[clave] !== numero) {
    throw new Error(`${JSON.stringify(clave)} no es ${numero} en el JSON: ${world.stdout}`);
  }
});

Then('el JSON no declara errores', () => {
  const errores = lista('errors');
  if (errores.length > 0) {
    throw new Error(`el JSON declara ${errores.length} errores y no debería: ${world.stdout}`);
  }
});

Then('el JSON declara al menos {int} error', (minimo: number) => {
  const errores = lista('errors');
  if (errores.length < minimo) {
    throw new Error(`el JSON declara ${errores.length} errores y esperaba al menos ${minimo}: ${world.stdout}`);
  }
});

Then('el primer error es del archivo {string}', (archivo: string) => {
  const primero = lista('errors')[0];
  if (primero?.file !== archivo) {
    throw new Error(`el primer error viene de ${JSON.stringify(primero?.file)} y esperaba ${JSON.stringify(archivo)}`);
  }
});

Then('el primer error dice {string}', (texto: string) => {
  const primero = lista('errors')[0];
  const mensaje = String(primero?.message ?? '');
  if (!mensaje.includes(texto)) {
    throw new Error(`el primer error no dice ${JSON.stringify(texto)}. Dice: ${JSON.stringify(mensaje)}`);
  }
});

Then('el JSON declara exactamente {int} aviso que menciona {string}', (cuantos: number, texto: string) => {
  const avisos = lista('warnings').filter((a) => String(a.message ?? '').includes(texto));

  if (avisos.length !== cuantos) {
    throw new Error(`el JSON declara ${avisos.length} avisos que mencionan ${JSON.stringify(texto)} y esperaba ${cuantos}: ${world.stdout}`);
  }
  world.ultimoAviso = avisos[0] ?? {};
});

Then('ese aviso viene del archivo {string}', (archivo: string) => {
  if (world.ultimoAviso?.file !== archivo) {
    throw new Error(`el aviso viene de ${JSON.stringify(world.ultimoAviso?.file)} y esperaba ${JSON.stringify(archivo)}`);
  }
});
