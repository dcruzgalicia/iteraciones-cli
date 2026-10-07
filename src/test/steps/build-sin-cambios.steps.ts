import { spyOn } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { After, Before, Given, Then, When } from '@cucumber/cucumber';
import { build } from '../../builder/orchestrator.js';
import { initTestProject } from '../helpers.js';

/**
 * #2546 (onda 2) — el atajo de "sin cambios" (#2496).
 *
 * ## Por qué este archivo va primero
 *
 * Es la primera prueba real del world object compartido de cucumber, y no usa
 * ni un `spyOn`: sólo un reporter doble que acumula lo que recibió. Si el
 * aislamiento del mundo se rompe, se rompe aquí y no 172 escenarios más
 * adelante.
 *
 * ## El reporter es un doble, no una aserción
 *
 * Acumula `logs` y `files` para que el Gherkin afecte sobre lo que el build
 * OBSERVÓ, no sobre una cadena de `expect` sobre el reporter. `Ningún documento
 * modificado` es un mensaje; que no se haya procesado nada es un hecho.
 */

/** El reporter que usaba el original: acumula logs y archivos, nada más. */
function recordingReporter(): Parameters<typeof build>[2] & { logs: string[]; files: string[] } {
  const logs: string[] = [];
  const files: string[] = [];
  return {
    logs,
    files,
    setFormats(): void {},
    planPhases(): void {},
    startPhase(): void {},
    reportFile(file: { relativePath: string }): void {
      files.push(file.relativePath);
    },
    completePhase(): void {},
    log(message: string): void {
      logs.push(message);
    },
    addWarning(): void {},
    addSummaryLine(): void {},
    showCleanup(): void {},
    startLightFormats(): void {},
    finish(): Promise<void> {
      return Promise.resolve();
    },
    fail(): Promise<void> {
      return Promise.resolve();
    },
  } as Parameters<typeof build>[2] & { logs: string[]; files: string[] };
}

const CONFIG_SIN_FORMATOS = ['language: es-MX', 'format:', '  html:', '    generate: true'].join('\n');

const NO_CAMBIOS = 'Ningún documento modificado — sin cambios';

interface ShortcircuitWorld {
  dir: string;
  reporter: ReturnType<typeof recordingReporter>;
}

const world: ShortcircuitWorld = { dir: '', reporter: recordingReporter() };

Before(async () => {
  world.dir = await mkdtemp(join(tmpdir(), 'iteraciones-gherkin-'));
  world.reporter = recordingReporter();
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
  // El reporter nuevo: el atajo tiene que decidir con ESTA corrida, no con lo que
  // ocurrió en la anterior.
  world.reporter = recordingReporter();
  await build(world.dir, {}, world.reporter);
});

When('compilo el proyecto vacío', async () => {
  world.reporter = recordingReporter();
  await build(world.dir, {}, world.reporter);
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
  // La limpieza vive ENTRE los dos guards: si el atajo cortó antes, no corrió.
  const limpio = world.reporter.logs.filter((l) => l.includes('archivo residual'));
  if (limpio.length > 0) throw new Error(`la limpieza corrió pese al atajo: ${JSON.stringify(limpio)}`);
});
/**
 * ## El par de aislamiento
 *
 * El escenario 1 instala un espía y NO lo restaura a propósito. El 2 comprueba
 * que ya no está. Entre los dos corre el `After` global de
 * `00-higiene-del-mundo.steps.ts`, que llama `mock.restore()`.
 *
 * Es la demostración que el issue pide: un `spyOn` sin restaurar NO puede
 * contaminar el escenario siguiente. Sin ese `After`, el escenario 2 fallaría con
 * un error sobre `process.cwd` — el fallo aparecería lejos de su causa, que es
 * justo lo que la onda 2 quiere evitar en sus 172 escenarios de `cli-layer`.
 *
 * `process.cwd` es el mismo espía que usó el spike (#2543) para medir la fuga, y
 * `A`/`B` son los nombres que tenía allí.
 */

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
