import { Given, Then, When } from '@cucumber/cucumber';
import { exec, killInFlightProcesses, mapWithConcurrency, ProcessTimeoutError } from '../../lib/run.js';
import { world } from './cli-world.steps.ts';

async function trabajo(n: number): Promise<number> {
  world.concurrentesRun = (world.concurrentesRun as number) + 1;
  world.maxConcurrentesRun = Math.max(world.maxConcurrentesRun as number, world.concurrentesRun as number);
  await new Promise((r) => setTimeout(r, 10));
  world.concurrentesRun = (world.concurrentesRun as number) - 1;
  (world.procesadosRun as number[]).push(n);

  return n * 2;
}

const lista = (texto: string): number[] =>
  texto
    .split(',')
    .map((i) => i.trim())
    .filter(Boolean)
    .map(Number);

Given('los items {string}', (items: string) => {
  world.itemsRun = lista(items);
  world.itemQueFalla = Number.NaN;
  world.itemsQueFallan = [];
  world.procesadosRun = [];
  world.concurrentesRun = 0;
  world.maxConcurrentesRun = 0;
  world.cancelesRun = 0;
});

Given('nadie falla', () => {
  world.itemQueFalla = Number.NaN;
  world.itemsQueFallan = [];
});

Given('el item {int} falla al procesarse', (item: number) => {
  world.itemQueFalla = item;
});

Given('los items {string} fallan al procesarse', (items: string) => {
  world.itemsQueFallan = lista(items);
});

When('los proceso con concurrencia {int}', async (limite: number) => {
  const falla = (n: number): boolean => n === world.itemQueFalla || (world.itemsQueFallan as number[]).includes(n);
  world.erroresRun = '';
  try {
    world.resultadoRun = await mapWithConcurrency(
      world.itemsRun as number[],
      limite,
      async (n: number) => {
        if (falla(n)) {
          await new Promise((r) => setTimeout(r, 5));
          throw new Error(n === world.itemQueFalla ? 'fallo deliberado' : `fallo ${n}`);
        }
        return trabajo(n);
      },
      {
        onCancel: () => {
          world.cancelesRun = (world.cancelesRun as number) + 1;
        },
      },
    );
  } catch (e) {
    world.erroresRun = e instanceof Error ? e.message : String(e);
    world.resultadoRun = undefined;
  }
});

When('los proceso con el límite {float}', async (limite: number) => {
  world.erroresRun = '';
  try {
    await mapWithConcurrency([1], limite, async (n: number) => n);
  } catch (e) {
    world.erroresRun = e instanceof Error ? e.message : String(e);
  }
});

Then('el resultado es {string}', (esperado: string) => {
  const leido = (world.resultadoRun as number[]) ?? [];
  const querido = lista(esperado.replace(/[[\]]/g, ''));
  if (leido.join(',') !== querido.join(',')) {
    throw new Error(`el resultado es [${leido.join(', ')}] y debería ser [${querido.join(', ')}]`);
  }
});

Then('nunca hubo más de {int} a la vez', (limite: number) => {
  if ((world.maxConcurrentesRun as number) > limite) {
    throw new Error(`hubo ${world.maxConcurrentesRun} a la vez y el límite era ${limite}`);
  }
});

Then('se procesaron los items {string}', (esperados: string) => {
  const leidos = [...(world.procesadosRun as number[])].sort((a, b) => a - b);
  const queridos = lista(esperados).sort((a, b) => a - b);
  if (leidos.join(',') !== queridos.join(',')) {
    throw new Error(`se procesaron [${leidos.join(', ')}] y debían ser [${queridos.join(', ')}]`);
  }
});

Then('no se procesaron todos los items', () => {
  const procesados = world.procesadosRun as number[];
  const total = world.itemsRun as number[];
  if (procesados.length >= total.length) {
    throw new Error(`se procesaron ${procesados.length} de ${total.length}: el abort no cortó nada`);
  }
});

Then('se excluyó el item que falla', () => {
  if ((world.procesadosRun as number[]).includes(world.itemQueFalla as number)) {
    throw new Error(`el item ${world.itemQueFalla} falló y aun así se procesó`);
  }
});

Then('el error es {string}', (esperado: string) => {
  if (world.erroresRun !== esperado) {
    throw new Error(`el error es ${JSON.stringify(world.erroresRun)} y debería ser ${JSON.stringify(esperado)}`);
  }
});

Then('el fallo del trabajo dice {string}', (esperado: string) => {
  if (!String(world.erroresRun).includes(esperado)) {
    throw new Error(`el error no dice ${JSON.stringify(esperado)}: ${world.erroresRun}`);
  }
});

Then('se invocó onCancel {int} veces', (cuantas: number) => {
  if (world.cancelesRun !== cuantas) {
    throw new Error(`onCancel se invocó ${world.cancelesRun} veces y el escenario dice ${cuantas}`);
  }
});

When('corro {string} sin timeout', async (comando: string) => {
  world.errorProceso = '';
  world.resultadoProceso = await exec(comando, ['hola']);
});

When('corro {string} que no termina, con timeout de {int} ms', async (comando: string, ms: number) => {
  world.errorProceso = '';
  world.esProcesoTimeout = false;
  try {
    world.resultadoProceso = await exec(comando, ['5'], { timeoutMs: ms });
  } catch (e) {
    world.errorProceso = e instanceof Error ? e.message : String(e);
    world.esProcesoTimeout = e instanceof ProcessTimeoutError;
  }
});

Then('el proceso termina bien', () => {
  const r = world.resultadoProceso as { exitCode: number; stdout: string };
  if (r.exitCode !== 0) throw new Error(`el código de salida es ${r.exitCode}`);
  if (!r.stdout.includes('hola')) throw new Error(`stdout es ${JSON.stringify(r.stdout)}`);
});

Then('el proceso se termina por timeout', () => {
  if (!world.esProcesoTimeout) throw new Error(`el error no es ProcessTimeoutError: ${world.errorProceso}`);
});

Then('el error dice que se llevaron también a sus hijos', () => {
  const mensaje = String(world.errorProceso);
  if (!mensaje.includes('fue terminado junto con sus procesos hijos')) {
    throw new Error(`el error no lo dice: ${mensaje}`);
  }
});

When('arranco un proceso largo y lo mato en vuelo', async () => {
  const pendiente = exec('sleep', ['30'], { timeoutMs: 25_000 });
  await new Promise((r) => setTimeout(r, 100));
  await killInFlightProcesses();
  world.errorProceso = '';
  try {
    world.resultadoProceso = await pendiente;
  } catch (e) {
    world.errorProceso = e instanceof Error ? e.message : String(e);
  }
});

Then('el proceso en vuelo terminó por el apagado', () => {
  if (world.errorProceso !== '') return;
  const codigo = (world.resultadoProceso as { exitCode: number }).exitCode;
  if (codigo === 0) throw new Error('el proceso salió con 0: el apagado no lo alcanzó');
});
