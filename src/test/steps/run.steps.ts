import { Given, Then, When } from '@cucumber/cucumber';
import { exec, killInFlightProcesses, mapWithConcurrency, ProcessTimeoutError } from '../../lib/run.js';
import { world } from './cli-world.steps.ts';

/**
 * #2580 (onda 2) — el concurrente y los timeouts del CLI.
 *
 * `mapWithConcurrency` es la base de todo lo que corre en paralelo: el pool de
 * PDF, la validación, las imágenes. Un fallo de contrato aquí no se ve en un
 * documento mal hecho, se ve en un build que se cuelga o que procesa de más.
 *
 * ## El orden de los resultados es parte del contrato
 *
 * Los resultados salen en el orden de la entrada aunque el trabajo termine
 * desordenado. El consumidor los indexa por posición, así que un resultado
 * desordenado mete el documento A donde va el B — y nada falla, que es peor.
 *
 * ## Un fallo aborta, y abortar se avisa una vez
 *
 * Cuando un item falla no tiene sentido seguir: el build va a salir con error
 * igual. Pero las tareas en vuelo no se pueden cancelar, así que se dejan
 * terminar; lo que no se hace es *encolar* más. `onCancel` se invoca una sola
 * vez, aunque fallen varios items (#2172), porque es el gancho que suelta un
 * semáforo: llamarlo N veces deja el semáforo en N−1 y cuelga lo que venga.
 *
 * ## El timeout mata el árbol entero, no el proceso (#2014)
 *
 * Matar sólo el proceso directo deja a los hijos escribiendo sobre los mismos
 * ficheros del temporal. El mensaje dice que también se llevaron a los hijos,
 * porque el autor tiene que saber que puede limpiar sin fear.
 */

/** El trabajo simulado: cuenta concurrencia y anota qué se procesó. */
async function trabajo(n: number): Promise<number> {
  world.concurrentesRun = (world.concurrentesRun as number) + 1;
  world.maxConcurrentesRun = Math.max(world.maxConcurrentesRun as number, world.concurrentesRun as number);
  await new Promise((r) => setTimeout(r, 10));
  world.concurrentesRun = (world.concurrentesRun as number) - 1;
  (world.procesadosRun as number[]).push(n);
  // El escenario duplica el valor: da algo que comparar más allá de "no falló".
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

/** El límite inválido no es un entero, así que no cabe en el mismo `When`. */
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

/**
 * El contrato del abort es "menos que todos", no "exactamente estos": qué
 * hermanos llegaron a empezar depende del scheduling. Lo que no puede pasar es
 * que se encolase todo lo pendiente.
 */
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

// ── Timeouts ───────────────────────────────────────────────────────────────

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

/**
 * El apagado ordenado: `exec()` registra el proceso y `killInFlightProcesses()`
 * lo mata. Sin esto un Ctrl-C deja procesos vivos y el autor ve el fallo de una
 * compilación que ya no controla.
 */
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
  if (world.errorProceso !== '') return; // el kill lo mató: eso es el resultado
  const codigo = (world.resultadoProceso as { exitCode: number }).exitCode;
  if (codigo === 0) throw new Error('el proceso salió con 0: el apagado no lo alcanzó');
});
