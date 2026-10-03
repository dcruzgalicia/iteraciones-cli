import { spyOn } from 'bun:test';
import { After, Then } from '@cucumber/cucumber';

/**
 * #2546 (onda 2) — el mundo compartido de los features del CLI.
 *
 * `parser`, `--project-root` y `new` hacen todos lo mismo: correr algo que
 * escribe en la terminal y mirar qué salió. Por eso el mundo y el `Then` están
 * aquí y no en cada step file — el mismo motivo que dejó `lua-world.ts` en la
 * onda 1: si cada archivo declarara su propio `world`, el `Then` quedaría
 * definido dos veces y cucumber reportaría `ambiguous`.
 *
 * ## Por qué `capture()` espía los dos streams
 *
 * Los errores de uso de commander van a **stderr**, pero `--help` también sale
 * por `CommanderError` y escribe en **stdout**, porque es ayuda y no un error.
 * Un helper que sólo espiara uno de los dos se rompería al halfway de la
 * migración, y el fallo se presentaría como "el CLI no imprimió nada".
 *
 * ## El código de salida tiene dos fuentes y este archivo las une
 *
 * - camino 1: un error de uso lanza `CommanderError` con su `exitCode`;
 * - camino 2: la validación de `--output` no lanza nada — corre en un hook del
 *   programa, escribe el mensaje y pone `process.exitCode`.
 *
 * Por eso `capture()` mira `process.exitCode` después del `await`, y el `When`
 * que sí recibe la excepción la sobreescribe. El `Then` lee un solo lugar y no
 * necesita saber por dónde pasó la salida.
 */

export const world = {
  stdout: '',
  stderr: '',
  exitCode: 0,
  /** Raíz temporal del escenario. La vacía cada `Given` de proyecto. */
  root: '',
};

/**
 * Corre `fn` con los dos streams espiados y deja el resultado en el mundo.
 * No captura excepciones: quien llama decide qué hacer con ellas.
 */
export async function capture(fn: () => Promise<void>): Promise<void> {
  const stdoutSpy = spyOn(process.stdout, 'write').mockImplementation(() => true);
  const stderrSpy = spyOn(process.stderr, 'write').mockImplementation(() => true);
  world.stdout = '';
  world.stderr = '';
  process.exitCode = 0;
  try {
    await fn();
    world.exitCode = process.exitCode ?? 0;
  } finally {
    world.stdout = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    world.stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  }
}

After(() => {
  process.exitCode = 0;
  world.stdout = '';
  world.stderr = '';
  world.exitCode = 0;
  world.root = '';
});

Then('el comando termina con el código de salida {int}', (codigo: number) => {
  if (world.exitCode !== codigo) {
    throw new Error(`esperaba código de salida ${codigo} y hubo ${world.exitCode}. stderr: ${JSON.stringify(world.stderr)}`);
  }
});

Then('el error dice {string}', (esperado: string) => {
  if (!world.stderr.includes(esperado)) {
    throw new Error(`el error no dice ${JSON.stringify(esperado)}. stderr: ${JSON.stringify(world.stderr)}`);
  }
});

Then('el error no dice {string}', (ruido: string) => {
  if (world.stderr.includes(ruido)) {
    throw new Error(`el error sí dice ${JSON.stringify(ruido)} y no debería: ${JSON.stringify(world.stderr)}`);
  }
});

Then('la salida de error no lleva ningún aviso', () => {
  // Un `⚠` acá sería un aviso que el CLI se está dando a sí mismo sobre un
  // nombre de archivo que es perfectamente válido.
  if (world.stderr.includes('⚠')) {
    throw new Error(`la salida lleva un aviso que no debería: ${JSON.stringify(world.stderr)}`);
  }
});
