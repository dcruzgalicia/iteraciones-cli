import { Given, Then, When } from '@cucumber/cucumber';
import {
  fmBool,
  fmString,
  fmStringList,
  fmTrimmedString,
  resolveBooleanField,
  resolveMetadataField,
  resolveStringField,
} from '../../lib/frontmatter-fields.js';
import { world } from './cli-world.steps.ts';

type Nivel = Record<string, unknown>;

const COMO = { texto: () => 'true' as const, uno: () => 1 as const };

function nivel(texto: string): Nivel {
  if (texto === 'nada') return {};
  const salida: Nivel = {};
  for (const par of texto.split(';;')) {
    const limpio = par.trim();
    if (!limpio) continue;
    const [clave, valor] = limpio.split('=');
    const bruto = (valor ?? '').trim();
    if (!clave) continue;
    if (bruto.startsWith('lista'))
      salida[clave] = bruto
        .slice(5)
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
    else if (bruto === 'true' || bruto === 'false') salida[clave] = bruto === 'true';
    else if (bruto in COMO) salida[clave] = COMO[bruto as keyof typeof COMO]();
    else salida[clave] = bruto;
  }
  return salida;
}

Given('el frontmatter tiene: {string}', (fm: string) => {
  world.nivelFm = nivel(fm);
});

Given('el formato tiene: {string}', (fmt: string) => {
  world.nivelFmt = nivel(fmt);
});

Given('la raíz tiene: {string}', (raiz: string) => {
  world.nivelRoot = nivel(raiz);
});

Given('el frontmatter no tiene nada', () => {
  world.nivelFm = {};
});

Given('el formato no tiene nada', () => {
  world.nivelFmt = {};
});

Given('la raíz no tiene nada', () => {
  world.nivelRoot = {};
});

Given('el valor de campo es la cadena {string}', (valor: string) => {
  world.valorCampo = valor.replace(/["']/g, '') === '(vacía)' ? '' : valor.replace(/["']/g, '');
});

Given('el valor de campo es el número {int}', (valor: number) => {
  world.valorCampo = valor;
});

Given('el valor de campo es la lista {string}', (valor: string) => {
  world.valorCampo = (valor === '(vacía)' ? '' : valor)
    .split(';;')
    .map((v) => v.trim())
    .filter((v) => v !== '');
});

Given('el valor de campo es la lista mixta {string}', (valor: string) => {
  world.valorCampo = (valor === '(vacía)' ? '' : valor)
    .split(';;')
    .map((v) => v.trim())
    .map((v) => (v === '' ? '' : Number.isNaN(Number(v)) ? v : Number(v)));
});

Given('el valor de campo es el booleano {string}', (valor: string) => {
  world.valorCampo = valor.replace(/["']/g, '') === 'true';
});

Given('el valor de campo es la cadena vacía', () => {
  world.valorCampo = '';
});

Given('el valor de campo es la lista vacía', () => {
  world.valorCampo = [];
});

Given('el valor de campo está ausente', () => {
  world.valorCampo = undefined;
});

When('lo leo como texto', () => {
  world.leido = fmString(world.valorCampo as string, 'x');
});

When('lo leo como texto recortado', () => {
  world.leido = fmTrimmedString(world.valorCampo as string);
});

When('lo leo como lista', () => {
  world.leido = fmStringList(world.valorCampo as string | string[]);
});

When('lo leo como booleano con el valor por defecto {string}', (defecto: string) => {
  const limpio = defecto.replace(/["']/g, '');
  world.leido = fmBool(world.valorCampo as boolean, limpio === 'true');
});

Then('lo leo como {string}', (esperado: string) => {
  if (String(world.leido) !== esperado) {
    throw new Error(`leí ${JSON.stringify(String(world.leido))} y esperaba ${JSON.stringify(esperado)}`);
  }
});

Then('no leo nada', () => {
  if (world.leido !== undefined) {
    throw new Error(`leí ${JSON.stringify(world.leido)} y no debía leer nada`);
  }
});

Then('lo leo el valor {word}', (esperado: string) => {
  const leido = String(world.leido);
  if (leido !== esperado) {
    throw new Error(`leí ${JSON.stringify(leido)} y esperaba ${JSON.stringify(esperado)}`);
  }
});

Then('lo leo como nada', () => {
  if (world.leido !== undefined) {
    throw new Error(`leí ${JSON.stringify(world.leido)} y no debía leer nada`);
  }
});

Then('lo leo como la lista {string}', (esperada: string) => {
  const leida = world.leido === undefined ? '(vacía)' : JSON.stringify(world.leido);
  const querida =
    esperada === '(vacía)'
      ? '(vacía)'
      : JSON.stringify(
          esperada
            .split(';;')
            .map((x) => x.trim())
            .filter((x) => x !== ''),
        );
  if (leida !== querida) throw new Error(`leí ${leida} y esperaba ${querida}`);
});

Given('el campo {string}', (campo: string) => {
  world.campoResuelto = campo;
});

When('resuelvo el campo como texto', () => {
  world.leido = resolveStringField(
    world.nivelFm as Nivel,
    (world.nivelFmt as Nivel | undefined) ?? {},
    world.nivelRoot as Nivel,
    world.campoResuelto as string,
  );
});

When('resuelvo el campo como texto con el formato ausente', () => {
  world.leido = resolveStringField(world.nivelFm as Nivel, undefined, world.nivelRoot as Nivel, world.campoResuelto as string);
});

When('resuelvo el campo como metadato', () => {
  world.leido = resolveMetadataField(world.nivelFm as Nivel, world.nivelFmt as Nivel, world.nivelRoot as Nivel, world.campoResuelto as string);
});

When('resuelvo el campo como booleano', () => {
  world.leido = resolveBooleanField(world.nivelFm as Nivel, world.nivelFmt as Nivel, world.nivelRoot as Nivel, world.campoResuelto as string);
});
