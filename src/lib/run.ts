export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface RunOptions {
  cwd?: string;
  timeoutMs?: number;
  input?: string;
  env?: Record<string, string>;
  onSpawn?: (pid: number) => void;
}

export class ProcessSpawnError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProcessSpawnError';
  }
}

export class ProcessTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProcessTimeoutError';
  }
}

async function childPids(pid: number): Promise<number[]> {
  try {
    const proc = Bun.spawn(['pgrep', '-P', String(pid)], { stdout: 'pipe', stderr: 'ignore' });
    const timer = setTimeout(() => proc.kill(), 2_000);
    const stdout = await new Response(proc.stdout).text();
    clearTimeout(timer);
    await proc.exited;
    return stdout
      .split('\n')
      .map((line) => Number.parseInt(line.trim(), 10))
      .filter((n) => Number.isInteger(n));
  } catch {
    return [];
  }
}

export async function killProcessTree(rootPid: number): Promise<void> {
  const order: number[] = [];
  const seen = new Set<number>();
  const queue = [rootPid];
  while (queue.length > 0) {
    const pid = queue.shift();
    if (pid === undefined || seen.has(pid)) continue;
    seen.add(pid);
    order.push(pid);
    queue.push(...(await childPids(pid)));
  }
  for (const pid of order.reverse()) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {}
  }
}

export async function exec(command: string, args: string[], options: RunOptions = {}): Promise<RunResult> {
  let proc: ReturnType<typeof Bun.spawn>;

  try {
    proc = Bun.spawn([command, ...args], {
      stdin: options.input !== undefined ? 'pipe' : 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
      cwd: options.cwd,
      env: options.env ? { ...process.env, ...options.env } : undefined,
    });
  } catch {
    throw new ProcessSpawnError(`No se encontró el comando "${command}". Verifica que esté instalado y disponible en PATH.`);
  }
  options.onSpawn?.(proc.pid);
  inFlightPids.add(proc.pid);
  try {
    return await awaitProcess(command, proc, options);
  } finally {
    inFlightPids.delete(proc.pid);
  }
}

const inFlightPids = new Set<number>();

export async function killInFlightProcesses(): Promise<void> {
  const pids = [...inFlightPids];
  await Promise.allSettled(pids.map((pid) => killProcessTree(pid)));
  inFlightPids.clear();
}

async function awaitProcess(command: string, proc: ReturnType<typeof Bun.spawn>, options: RunOptions): Promise<RunResult> {
  if (options.input !== undefined) {
    if (proc.stdin == null || typeof proc.stdin === 'number') {
      throw new Error(`No se pudo escribir stdin del comando "${command}".`);
    }
    proc.stdin.write(options.input);
    await proc.stdin.flush();
    proc.stdin.end();
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
    void killProcessTree(proc.pid);
  }, options.timeoutMs);
  const [stdout, stderr, exitCode] = await outputPromise;
  clearTimeout(timer);
  if (timedOut) {
    throw new ProcessTimeoutError(
      `el comando "${command}" no terminó en ${Math.round(options.timeoutMs / 1000)}s y fue terminado junto con sus procesos hijos.`,
    );
  }
  return { stdout, stderr, exitCode };
}

export interface MapConcurrencyOptions {
  onCancel?: () => Promise<void> | void;
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
  options: MapConcurrencyOptions = {},
): Promise<R[]> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`mapWithConcurrency: limit debe ser un entero >= 1, recibido: ${limit}`);
  }
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  let aborted = false;
  let firstError: unknown = null;
  let cancelStarted = false;

  const firstFailure = async (err: unknown): Promise<void> => {
    if (firstError !== null) return;
    firstError = err;
    aborted = true;
    if (options.onCancel && !cancelStarted) {
      cancelStarted = true;
      try {
        await options.onCancel();
      } catch {}
    }
  };

  async function worker(): Promise<void> {
    while (!aborted && nextIndex < items.length) {
      const index = nextIndex++;
      const item = items[index];
      if (item === undefined) throw new Error(`mapWithConcurrency: item ${index} sin definir`);
      try {
        results[index] = await fn(item);
      } catch (err) {
        await firstFailure(err);
        return; // el worker sale; el error se propaga una vez al final
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  if (firstError !== null) throw firstError;
  return results;
}
