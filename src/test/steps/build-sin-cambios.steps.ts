import { spyOn } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { After, Before, Given, Then, When } from '@cucumber/cucumber';
import { build } from '../../builder/orchestrator.js';
import { fakeReporter, initTestProject } from '../helpers.js';

const CONFIG_SIN_FORMATOS = ['language: es-MX', 'format:', '  html:', '    generate: true'].join('\n');

const NO_CAMBIOS = 'Ningún documento modificado — sin cambios';

interface ShortcircuitWorld {
  dir: string;
  reporter: ReturnType<typeof fakeReporter>;
}

const world: ShortcircuitWorld = { dir: '', reporter: fakeReporter() };

Before(async () => {
  world.dir = await mkdtemp(join(tmpdir(), 'iteraciones-gherkin-'));
  world.reporter = fakeReporter();
});

After(async () => {
  await rm(world.dir, { recursive: true, force: true });
});

Given('un proyecto de prueba con un documento inicial', () => {
  initTestProject(world.dir);
});

Given('un proyecto sin documentos', async () => {
  await mkdir(world.dir, { recursive: true });
  await Bun.write(join(world.dir, 'iteraciones.config.yaml'), CONFIG_SIN_FORMATOS);
});

When('compilo el proyecto completo', async () => {
  await build(world.dir, { full: true });
});

When('compilo otra vez sin tocar nada', async () => {
  world.reporter = fakeReporter();
  await build(world.dir, {}, world.reporter.reporter);
});

When('compilo el proyecto vacío', async () => {
  world.reporter = fakeReporter();
  await build(world.dir, {}, world.reporter.reporter);
});

Then('el build avisa que no hubo cambios', () => {
  if (!world.reporter.logs.includes(NO_CAMBIOS)) {
    throw new Error(`el reporter no registró "${NO_CAMBIOS}". Logs: ${JSON.stringify(world.reporter.logs)}`);
  }
});

Then('el build no dispara el atajo de sin cambios', () => {
  if (world.reporter.logs.includes(NO_CAMBIOS)) {
    throw new Error('un proyecto sin documentos no debe disparar el atajo: ese return ocurre antes de los guards');
  }
});

Then('no procesa ningún documento', () => {
  if (world.reporter.files.length !== 0) {
    throw new Error(`el build procesó ${world.reporter.files.length} documentos y debía procesar ninguno: ${JSON.stringify(world.reporter.files)}`);
  }
});

Then('no limpia archivos residuales', () => {
  const limpio = world.reporter.logs.filter((l) => l.includes('archivo residual'));
  if (limpio.length > 0) throw new Error(`la limpieza corrió pese al atajo: ${JSON.stringify(limpio)}`);
});

const DIR_FALSO = '/espurio';
const REAL = process.cwd();

Given('un espía sin restaurar sobre el registro de documentos modificados', () => {
  spyOn(process, 'cwd').mockReturnValue(DIR_FALSO);
});

Then('el espía sigue puesto y este escenario lo ve', () => {
  const actual = process.cwd();
  if (actual !== DIR_FALSO) {
    throw new Error(`el espía ya no estaba puesto (${actual}); si falla aquí es porque el espía se restauró demasiado pronto`);
  }
});

Then('el espía ya no está puesto', () => {
  const actual = process.cwd();
  if (actual === DIR_FALSO) {
    throw new Error('FUGA: el espía del escenario anterior sobrevivió. El After global con mock.restore() no está limpiando');
  }
  if (actual !== REAL) throw new Error(`process.cwd() devolvió ${actual} y el real es ${REAL}`);
});
