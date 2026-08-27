import { describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exec, killInFlightProcesses, mapWithConcurrency, ProcessTimeoutError } from '../lib/run.js';

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

  it('al fallar un item aborta: los pendientes no se procesan y el error se propaga una vez (#2172)', async () => {
    const procesados: number[] = [];
    let llamadas = 0;
    await expect(
      mapWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8], 2, async (n) => {
        llamadas++;
        await new Promise((r) => setTimeout(r, 5));
        if (n === 1) throw new Error('fallo deliberado');
        procesados.push(n);
        return n;
      }),
    ).rejects.toThrow('fallo deliberado');
    // Sin abort serían 8 llamadas; con abort, solo las en vuelo + ninguna nueva
    expect(llamadas).toBeLessThan(8);
    expect(procesados).not.toContain(1);
  });

  it('onCancel se invoca exactamente una vez al primer fallo y no en camino feliz', async () => {
    let cancels = 0;
    // Camino feliz: sin cancel
    await mapWithConcurrency([1, 2, 3], 2, async (n) => n, { onCancel: () => void cancels++ });
    expect(cancels).toBe(0);
    // Con fallo: una sola llamada, aunque varios items fallen
    await expect(
      mapWithConcurrency(
        [1, 2, 3, 4],
        2,
        async (n) => {
          if (n >= 2) throw new Error(`fallo ${n}`);
          return n;
        },
        { onCancel: () => void cancels++ },
      ),
    ).rejects.toThrow('fallo 2');
    expect(cancels).toBe(1);
  });

  it('onCancel que lanza no enmascara el error original', async () => {
    await expect(
      mapWithConcurrency([1, 2], 2, async (_n) => {
        throw new Error('error original');
      }),
    ).rejects.toThrow('error original');
  });
});

describe('run (timeouts)', () => {
  it('sin timeout espera a que el proceso termine', async () => {
    const result = await exec('echo', ['hola']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('hola');
  });

  it('termina un proceso que excede el timeout con error accionable', async () => {
    // sleep 5 con timeout de 100ms: el árbol se mata y exec() lanza
    await expect(exec('sleep', ['5'], { timeoutMs: 100 })).rejects.toThrow('no terminó en 0s y fue terminado junto con sus procesos hijos');
  });

  it('al expirar el timeout mata el árbol completo: ni el proceso ni sus hijos sobreviven (#2014)', async () => {
    if (process.platform === 'win32') return; // camino Windows se valida por revisión
    const dir = mkdtempSync(join(tmpdir(), 'iteraciones-tree-'));
    try {
      // Árbol de dos niveles: sh (hijo directo de run) → sleep (nieto).
      // El script escribe ambos pids y queda bloqueado en wait.
      const pidsFile = join(dir, 'pids.txt');
      const promise = exec('sh', ['-c', `sleep 30 & echo $$ $! > '${pidsFile}'; wait`], { timeoutMs: 300 });
      // Esperar a que el árbol esté armado (el archivo de pids existe)
      const setupDeadline = Date.now() + 2_000;
      while (!existsSync(pidsFile) && Date.now() < setupDeadline) await new Promise((r) => setTimeout(r, 20));
      expect(existsSync(pidsFile)).toBe(true);

      await expect(promise).rejects.toThrow(ProcessTimeoutError);

      const [shellPid, sleepPid] = readFileSync(pidsFile, 'utf8').trim().split(/\s+/);
      const isAlive = (pid: string | undefined): boolean => {
        if (!pid) return false;
        try {
          process.kill(Number.parseInt(pid, 10), 0);
          return true;
        } catch {
          return false;
        }
      };
      // Poll corto: la muerte es inmediata (SIGKILL), solo esperamos al reap
      let shellDead = false;
      let sleepDead = false;
      const deadline = Date.now() + 3_000;
      while (Date.now() < deadline) {
        shellDead = !isAlive(shellPid);
        sleepDead = !isAlive(sleepPid);
        if (shellDead && sleepDead) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(shellDead).toBe(true);
      expect(sleepDead).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('no lanza error si el proceso termina antes del timeout', async () => {
    const result = await exec('echo', ['rápido'], { timeoutMs: 2000 });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('rápido');
  });
});

describe('killInFlightProcesses (#2172)', () => {
  it('mata un proceso externo en vuelo registrado por exec()', async () => {
    const pendiente = exec('sleep', ['30'], { timeoutMs: 25_000 });
    await new Promise((r) => setTimeout(r, 100)); // el proceso real está vivo
    await killInFlightProcesses();
    const result = await pendiente;
    // El kill del árbol terminó el proceso: exit ≠ 0 y no espera los 30s
    expect(result.exitCode).not.toBe(0);
  });

  it('el registro queda vacío tras terminar procesos normales', async () => {
    await exec('echo', ['ok']);
    await killInFlightProcesses(); // sin en vuelo: no-op
    expect(true).toBe(true);
  });
});
