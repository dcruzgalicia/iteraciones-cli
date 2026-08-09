export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface RunOptions {
  /** Directorio de trabajo del proceso (por defecto: el del proceso actual). */
  cwd?: string;
  /**
   * Límite de tiempo en ms. Si el proceso no termina, se mata y run() lanza un
   * error accionable. Sin timeout el proceso puede colgar el build para siempre.
   */
  timeoutMs?: number;
}

export async function run(command: string, args: string[], options: RunOptions = {}): Promise<RunResult> {
  let proc: ReturnType<typeof Bun.spawn>;

  try {
    proc = Bun.spawn([command, ...args], {
      stdout: 'pipe',
      stderr: 'pipe',
      cwd: options.cwd,
    });
  } catch {
    // Error esperado: ENOENT al spawnear; el mensaje accionable es más útil que la causa técnica
    throw new Error(`No se encontró el comando "${command}". Verifica que esté instalado y disponible en PATH.`);
  }

  if (proc.stdout == null || typeof proc.stdout === 'number') {
    throw new Error(`No se pudo leer stdout del comando "${command}".`);
  }

  if (proc.stderr == null || typeof proc.stderr === 'number') {
    throw new Error(`No se pudo leer stderr del comando "${command}".`);
  }

  const outputPromise = Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  if (options.timeoutMs === undefined) {
    const [stdout, stderr, exitCode] = await outputPromise;
    return { stdout, stderr, exitCode };
  }

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, options.timeoutMs);
  const [stdout, stderr, exitCode] = await outputPromise;
  // El kill del timeout resuelve proc.exited: este clearTimeout siempre corre
  // y no deja timers vivos que cuelguen el event loop tras el build.
  clearTimeout(timer);
  if (timedOut) {
    throw new Error(
      `el comando "${command}" no terminó en ${Math.round(options.timeoutMs / 1000)}s y fue terminado. Revisa procesos colgados o filtros Lua en loop.`,
    );
  }
  return { stdout, stderr, exitCode };
}

/**
 * Ejecuta `fn` sobre cada item con un máximo de `limit` promesas simultáneas.
 * Preserva el orden del array de resultados.
 */
export async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`mapWithConcurrency: limit debe ser un entero >= 1, recibido: ${limit}`);
  }
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      // Invariante del while: items[index] siempre existe (el guard es defensivo)
      const item = items[index];
      if (item === undefined) throw new Error(`mapWithConcurrency: item ${index} sin definir`);
      results[index] = await fn(item);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}
