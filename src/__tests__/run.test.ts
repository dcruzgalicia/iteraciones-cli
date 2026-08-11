import { describe, expect, it } from 'bun:test';
import { mapWithConcurrency, run } from '../lib/run.js';

describe('mapWithConcurrency', () => {
  it('procesa todos los items', async () => {
    const result = await mapWithConcurrency([1, 2, 3], 2, async (n) => n * 2);
    expect(result).toEqual([2, 4, 6]);
  });

  it('preserva el orden de los items', async () => {
    const input = ['a', 'b', 'c', 'd'];
    const result = await mapWithConcurrency(input, 3, async (x) => x.toUpperCase());
    expect(result).toEqual(['A', 'B', 'C', 'D']);
  });

  it('funciona con array vacío', async () => {
    const result = await mapWithConcurrency([], 2, async (x: number) => x);
    expect(result).toEqual([]);
  });

  it('funciona con limit = 1 (serial)', async () => {
    const result = await mapWithConcurrency([10, 20, 30], 1, async (n) => n + 1);
    expect(result).toEqual([11, 21, 31]);
  });

  it('lanza error si limit no es entero positivo', async () => {
    await expect(mapWithConcurrency([1], 0, async (n) => n)).rejects.toThrow('entero >= 1');
    await expect(mapWithConcurrency([1], -1, async (n) => n)).rejects.toThrow('entero >= 1');
    await expect(mapWithConcurrency([1], 1.5, async (n) => n)).rejects.toThrow('entero >= 1');
  });

  it('no excede el límite de concurrencia', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;

    const result = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      // simular trabajo asíncrono
      await new Promise((r) => setTimeout(r, 10));
      concurrent--;
      return n;
    });

    expect(maxConcurrent).toBeLessThanOrEqual(2);
    expect(result).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('run (timeouts)', () => {
  it('sin timeout espera a que el proceso termine', async () => {
    const result = await run('echo', ['hola']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('hola');
  });

  it('termina un proceso que excede el timeout con error accionable', async () => {
    // sleep 5 con timeout de 100ms: el proceso se mata y run() lanza
    await expect(run('sleep', ['5'], { timeoutMs: 100 })).rejects.toThrow(
      'no terminó en 0s y fue terminado. Revisa procesos colgados o filtros Lua en loop',
    );
  });

  it('no lanza error si el proceso termina antes del timeout', async () => {
    const result = await run('echo', ['rápido'], { timeoutMs: 2000 });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('rápido');
  });
});
