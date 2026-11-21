import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Then } from '@cucumber/cucumber';
import { parse } from 'yaml';
import { world } from './cli-world.steps.js';

interface Config {
  format?: Record<string, { generate?: boolean }>;
}

Then('la configuración activa los formatos {string}', (lista: string) => {
  const config = parse(readFileSync(join(world.root, 'iteraciones.config.yaml'), 'utf8')) as Config;
  const activos = Object.entries(config.format ?? {})
    .filter(([, formato]) => formato?.generate === true)
    .map(([nombre]) => nombre);
  const esperados = lista
    .split(',')
    .map((nombre) => nombre.trim())
    .filter(Boolean);
  const iguales = activos.length === esperados.length && esperados.every((nombre) => activos.includes(nombre));
  if (!iguales) throw new Error(`formatos activos ${JSON.stringify(activos)} y esperaba ${JSON.stringify(esperados)}`);
});
