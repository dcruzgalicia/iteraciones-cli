import { Given, Then, When } from '@cucumber/cucumber';
import { computeActiveFormats } from '../../config/site-config.js';
import { world } from './cli-world.steps.ts';

const APAGADOS = {
  latex: { generate: false },
  html: { generate: false },
  pdf: { generate: false },
  epub: { generate: false },
  markdown: { generate: false, merge: false },
};

Given('ningún formato activo', () => {
  world.formatosPedidos = { ...APAGADOS };
});

Given('el formato {word} está generating', (formato: string) => {
  const clave = formato as keyof typeof APAGADOS;
  world.formatosPedidos = { ...(world.formatosPedidos ?? APAGADOS), [clave]: { ...APAGADOS[clave], generate: true } };
});

Given('el formato markdown sólo pide merge', () => {
  world.formatosPedidos = {
    ...(world.formatosPedidos ?? APAGADOS),
    markdown: { generate: false, merge: true },
  };
});

Given('los formatos {string} están generating', (lista: string) => {
  world.formatosPedidos = { ...APAGADOS };
  for (const f of lista.split(',')) {
    const clave = f.trim() as keyof typeof APAGADOS;
    if (!clave) continue;
    world.formatosPedidos[clave] = { ...APAGADOS[clave], generate: true };
  }
});

When('calculo qué formatos salen', () => {
  world.formatosActivosCalc = computeActiveFormats((world.formatosPedidos ?? APAGADOS) as Parameters<typeof computeActiveFormats>[0]);
});

Then('no sale ningún formato', () => {
  const leidos = [...(world.formatosActivosCalc as string[])];
  if (leidos.length > 0) throw new Error(`salieron ${JSON.stringify(leidos)} y no debía salir ninguno`);
});

Then('los formatos que salen son:', (esperado: string) => {
  const leidos = [...(world.formatosActivosCalc as string[])].join(', ');
  const queried = esperado
    .split(/[\n,]/)
    .map((x) => x.trim())
    .filter(Boolean)
    .join(', ');
  if (leidos !== queried) {
    throw new Error(`los formatos que salen son ${JSON.stringify(leidos)} y debían ser ${JSON.stringify(queried)}`);
  }
});
