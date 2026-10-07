import { Given, Then, When } from '@cucumber/cucumber';
import { dictumWidthWarnings, dictumWidthWarningsInYaml } from '../../builder/project-validator.js';
import { world } from './cli-world.steps.ts';

interface Aviso {
  line: number;
  value: number;
}

const CON_CERCA = ['::: {.dictum width=5}', 'primero', '```', '::: {.dictum width=9}', 'dentro de la cerca', '```', '::: {.dictum width=0.5}'].join(
  '\n',
);

Given('un documento con dictums dentro y fuera de una cerca de código', () => {
  world.textoDictum = CON_CERCA;
});

Given('el texto:', (texto: string) => {
  world.textoDictum = texto;
});

Given('el desplazamiento de línea es {int}', (desplazamiento: number) => {
  world.desplazamientoDictum = desplazamiento;
});

When('escaneo los anchos del body', () => {
  world.avisosDictum = dictumWidthWarnings(world.textoDictum as string, world.desplazamientoDictum as number | undefined);
});

When('escaneo los anchos del fragmento YAML', () => {
  world.avisosDictum = dictumWidthWarningsInYaml(world.textoDictum as string);
});

Then('no hay ningún ancho fuera de rango', () => {
  const avisos = world.avisosDictum as Aviso[];
  if (avisos.length > 0) throw new Error(`hay avisos: ${JSON.stringify(avisos)}`);
});

Then('los anchos fuera de rango son:', (lista: string) => {
  const leidos = (world.avisosDictum as Aviso[]).map((a) => `${a.value} ;; línea ${a.line}`).join('\n');
  const queried = lista
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
  if (leidos !== queried) {
    throw new Error(`los anchos fuera de rango son\n${leidos}\ny debían ser\n${queried}`);
  }
});
