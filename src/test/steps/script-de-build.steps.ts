import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { After, Before, Given, Then, When } from '@cucumber/cucumber';
import { loadSiteConfig } from '../../config/config-loader.js';
import {
  beginScriptCapture,
  commitScriptCapture,
  notePdfSlots,
  prepareArgv,
  recordScriptExec,
  recordSupportCommand,
} from '../../lib/script-recorder.js';
import { systemCommands } from '../helpers.js';

const PERMITIDO = ['#!/bin/bash', 'set -e', 'cd /raíz', '# comentario cp rm', 'mkdir -p dist dist/files', 'mv .cover-a-1.png portada.png'].join('\n');

const MARCADO = ['cp a b', 'rm -f c', 'ln -s d e', 'rmdir f', 'pandoc x && mv y z'].join('\n');

const CONFIG_SIN_SCRIPT = 'language: es-MX\n';
const CONFIG_SCRIPT_TRUE = 'language: es-MX\nscript: true\n';
const CONFIG_SCRIPT_FALSE = 'language: es-MX\nscript: false\n';
const CONFIG_FORMAT_SCRIPT = 'language: es-MX\nformat:\n  script: true\n';

interface ScriptWorld {
  dir: string;
  root: string;
  script: string;
  scriptValue: boolean | undefined;
  configError: string;
}

const world: ScriptWorld = { dir: '', root: '', script: '', scriptValue: undefined, configError: '' };

Before(async () => {
  world.dir = await mkdtemp(join(tmpdir(), 'iteraciones-gherkin-'));
  world.root = join(world.dir, 'proyecto');
});

After(async () => {
  await rm(world.dir, { recursive: true, force: true });
});

Given('un script que sólo usa mkdir y mv', () => {
  world.script = PERMITIDO;
});

Given('un script con cp, rm, ln, rmdir y &&', () => {
  world.script = MARCADO;
});

Then('el guard de primitivas no encuentra ninguna', () => {
  const encontradas = systemCommands(world.script);
  if (encontradas.length > 0) {
    throw new Error(`esperaba ninguna primitiva prohibida y encontré ${JSON.stringify(encontradas)}`);
  }
});

Then('el guard de primitivas encuentra las cinco', () => {
  const encontradas = systemCommands(world.script);
  const esperado = ['&&', 'cp', 'ln', 'rm', 'rmdir'];
  if (JSON.stringify(encontradas) !== JSON.stringify(esperado)) {
    throw new Error(`esperaba ${JSON.stringify(esperado)} y encontré ${JSON.stringify(encontradas)}`);
  }
});

Given('un proyecto con dos jobs repartidos en slots del pool 3 y 1', () => {
  world.script = '';
});

When('grabo la captura del script', async () => {
  const root = world.root;
  const slot = (n: number): string => join(root, '.iteraciones', 'tmp', 'pdf', `slot-${n}`);
  const cache = (n: number): string => join(root, '.iteraciones', 'biber', `cache-${n}`);

  beginScriptCapture(root);
  notePdfSlots(2);

  for (const [job, poolSlot] of [
    ['ensayo-a', 3],
    ['ensayo-b', 1],
  ] as const) {
    recordSupportCommand('pdf', job, prepareArgv([cache(poolSlot), slot(poolSlot)], [slot(poolSlot)]));
    recordScriptExec(
      'latexmk',
      ['-pdf', `-outdir=${slot(poolSlot)}`, `-jobname=${job}`, join(root, 'tmp', `${job}.tex`)],
      { env: { PAR_GLOBAL_TEMP: cache(poolSlot), TEXINPUTS: `${slot(poolSlot)}:` } },
      '',
    );
    recordSupportCommand('pdf', job, ['iteraciones', 'pdf', 'collect', slot(poolSlot), '-o', join(root, 'dist', 'files', `${job}.pdf`)]);
  }
  await commitScriptCapture();
  world.script = await readFile(join(root, 'build.sh'), 'utf8');
});

Then('el script numera los slots desde el job cero y no usa el slot real del pool', () => {
  const s = world.script;
  const espera = [
    [/iteraciones prepare .*--dir \S*cache-0 .*--dir \S*slot-0 .*--xmp \S*slot-0/m, 'prepare con cache-0 y slot-0'],
    [/-outdir=\S*slot-0 /, 'outdir del primer job'],
    [/PAR_GLOBAL_TEMP=\S*cache-0 /, 'PAR_GLOBAL_TEMP del primer job'],
    [/TEXINPUTS=\S*slot-0:/, 'TEXINPUTS del primer job'],
    [/pdf collect \S*slot-1 -o \S*dist\/files\/ensayo-b\.pdf/, 'collect del segundo job'],
  ] as const;
  for (const [re, que] of espera) {
    if (!re.test(s)) throw new Error(`falta ${que}.\nscript:\n${s.slice(0, 600)}`);
  }

  for (const prohibido of ['slot-3', 'cache-3']) {
    if (s.includes(prohibido)) throw new Error(`el script conserva ${prohibido}, que es el slot real del pool y no el índice del job`);
  }
});

Given('un proyecto con la configuración', async () => {
  await Bun.write(join(world.dir, 'iteraciones.config.yaml'), CONFIG_SIN_SCRIPT);
});

Given('un proyecto con la clave script dentro de format', async () => {
  await Bun.write(join(world.dir, 'iteraciones.config.yaml'), CONFIG_FORMAT_SCRIPT);
});

When('leo la configuración del proyecto', async () => {
  world.configError = '';
  try {
    world.scriptValue = (await loadSiteConfig(world.dir)).script;
  } catch (error) {
    world.configError = String(error);
  }
});

Then('la clave script es falsa', async () => {
  if (world.scriptValue !== false) throw new Error(`esperaba script=false y obtuve ${String(world.scriptValue)}`);

  for (const [config, esperado] of [
    [CONFIG_SCRIPT_TRUE, true],
    [CONFIG_SCRIPT_FALSE, false],
  ] as const) {
    await Bun.write(join(world.dir, 'iteraciones.config.yaml'), config);
    const got = (await loadSiteConfig(world.dir)).script;
    if (got !== esperado) throw new Error(`con ${JSON.stringify(config)} esperaba ${esperado} y obtuve ${String(got)}`);
  }
});

Then('la lectura falla diciendo que hay que renombrar la clave', () => {
  if (!world.configError.includes('renombra la clave')) {
    throw new Error(`esperaba un error de rename y obtuve: ${world.configError || '(no hubo error)'}`);
  }

  if (!world.configError.includes('format.script')) {
    throw new Error(`el error no nombra "format.script": ${world.configError}`);
  }
});
