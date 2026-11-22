import { spyOn } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Then, When } from '@cucumber/cucumber';
import { parse } from 'yaml';
import { runAdd, runCreate } from '../../cli/dispatcher.js';
import { capture, world } from './cli-world.steps.js';

interface Config {
  format?: Record<string, { generate?: boolean }>;
}

When('creo el proyecto y agrego Sveltia sin comandos externos', async () => {
  const spawn = spyOn(Bun, 'spawn').mockImplementation(() => {
    throw new Error('Bun.spawn no permitido');
  });
  const spawnSync = spyOn(Bun, 'spawnSync').mockImplementation(() => {
    throw new Error('Bun.spawnSync no permitido');
  });
  try {
    await capture(async () => {
      await runCreate(world.root, undefined, {
        prompt: false,
        sveltia: true,
        repo: 'grupo/sitio',
        siteUrl: 'https://sitio.example',
        appId: 'abc123',
      });
    });
    await capture(async () => {
      await runAdd(world.root, 'sveltia', {
        prompt: false,
        repo: 'grupo/sitio',
        siteUrl: 'https://sitio.example',
        appId: 'abc123',
      });
    });
  } finally {
    spawn.mockRestore();
    spawnSync.mockRestore();
  }
});

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
