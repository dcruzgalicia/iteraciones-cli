export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface RunOptions {
  /** Directorio de trabajo del proceso (por defecto: el del proceso actual). */
  cwd?: string;
  /**
   * Límite de tiempo en ms. Si el proceso no termina, se mata y run() lanza un
   * error accionable. Sin timeout el proceso puede colgar el build para siempre.
   */
  timeoutMs?: number;
  /** Contenido a escribir en stdin (el pipe se cierra al terminar). */
  input?: string;
  /** Variables de entorno adicionales (merge sobre process.env). */
  env?: Record<string, string>;
  /**
   * Notifica el pid del proceso justo tras el spawn. Para gestión externa del
   * ciclo de vida (p. ej. el pool PDF mata el latexmk en vuelo al quiescer).
   */
  onSpawn?: (pid: number) => void;
}

/**
 * El comando no se pudo lanzar (ENOENT: no está en PATH o no es ejecutable).
 * Los call sites lo capturan para traducirlo a su mensaje específico
 * (p. ej. PandocError/ExportError con instrucciones de instalación).
 */
export class ProcessSpawnError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProcessSpawnError';
  }
}

/**
 * El proceso no terminó dentro de timeoutMs y fue terminado junto con sus
 * procesos hijos. Los call sites lo capturan para traducirlo a su mensaje
 * específico con contexto (p. ej. la ruta del log de latexmk).
 */
export class ProcessTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProcessTimeoutError';
  }
}

/** PIDs de los hijos directos de un proceso (pgrep -P). Sin pgrep: lista vacía. */
async function childPids(pid: number): Promise<number[]> {
  try {
    const proc = Bun.spawn(['pgrep', '-P', String(pid)], { stdout: 'pipe', stderr: 'ignore' });
    // Defensa contra un pgrep colgado: nunca debe superar los 2 s.
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

/**
 * Termina el árbol completo de un proceso (issue #2014). Un latexmk o pandoc
 * con filtros deja nietos vivos si solo se mata el hijo directo.
 *
 * POSIX: recolecta el árbol con pgrep -P ANTES de matar (al morir el padre,
 * los hijos se reparentan y dejarían de ser descubribles) y lanza SIGKILL de
 * los más profundos a la raíz. Sin pgrep disponible degrada a matar solo el
 * proceso raíz (comportamiento previo).
 *
 * Windows: taskkill /T /F hace lo propio en una invocación.
 */
export async function killProcessTree(rootPid: number): Promise<void> {
  if (process.platform === 'win32') {
    try {
      const proc = Bun.spawn(['taskkill', '/T', '/F', '/PID', String(rootPid)], { stdout: 'ignore', stderr: 'ignore' });
      void proc.exited;
    } catch {
      // Ya murió o taskkill no está disponible: nada que hacer
    }
    return;
  }
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
    } catch {
      // ESRCH: ya murió (p. ej. por la muerte de su padre)
    }
  }
}

/**
 * Primitive de ejecución de procesos con pipes y timeout: única
 * implementación de spawn + stdin/stdout/stderr + timeout de todo el
 * pipeline (pandoc, latexmk y cualquier binario futuro). Los call sites
 * traducen ProcessSpawnError/ProcessTimeoutError a sus mensajes accionables.
 */
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
    // Error esperado: ENOENT al spawnear; el mensaje accionable es más útil que la causa técnica
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

/** Pids de procesos externos en vuelo de este proceso CLI (registro de exec()). */
const inFlightPids = new Set<number>();

/**
 * Mata TODOS los procesos externos en vuelo (#2172). Se invoca cuando un
 * documento falla en el pool 1: los hermanos en vuelo terminan al instante y
 * dejan de escribir en dist/ después del error. Los pids vienen del registro
 * de exec(), la única primitiva de spawn.
 */
export async function killInFlightProcesses(): Promise<void> {
  const pids = [...inFlightPids];
  await Promise.allSettled(pids.map((pid) => killProcessTree(pid)));
  inFlightPids.clear();
}

/** Lectura de pipes, timeout y conversión a RunResult (extraído de exec()). */
async function awaitProcess(command: string, proc: ReturnType<typeof Bun.spawn>, options: RunOptions): Promise<RunResult> {
  if (options.input !== undefined) {
    if (proc.stdin == null || typeof proc.stdin === 'number') {
      throw new Error(`No se pudo escribir stdin del comando "${command}".`);
    }
    proc.stdin.write(options.input);
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
    // El árbol completo, no solo el hijo directo: latexmk deja pdflatex y
    // pandoc deja filtros/perl vivos si se mata solo el padre (issue #2014).
    void killProcessTree(proc.pid);
  }, options.timeoutMs);
  const [stdout, stderr, exitCode] = await outputPromise;
  // El kill del timeout resuelve proc.exited: este clearTimeout siempre corre
  // y no deja timers vivos que cuelguen el event loop tras el build.
  clearTimeout(timer);
  if (timedOut) {
    throw new ProcessTimeoutError(
      `el comando "${command}" no terminó en ${Math.round(options.timeoutMs / 1000)}s y fue terminado junto con sus procesos hijos.`,
    );
  }
  return { stdout, stderr, exitCode };
}

/** Opciones de cancelación de mapWithConcurrency. */
export interface MapConcurrencyOptions {
  /**
   * Se invoca UNA vez al primer rechazo, antes de que los workers restantes
   * terminen: mata los procesos en vuelo para que los items hermanos no
   * sigan escribiendo después del error (#2172). Los errores del propio
   * cancel se ignoran: el error original manda.
   */
  onCancel?: () => Promise<void> | void;
}

/**
 * Ejecuta `fn` sobre cada item con un máximo de `limit` promesas simultáneas.
 * Preserva el orden del array de resultados.
 *
 * Cancelación (#2172): al primer rechazo, los workers dejan de tomar items,
 * se invoca `onCancel` una vez y se espera a que los en vuelo terminen antes
 * de propagar el error original — nadie escribe después del throw.
 */
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

  /** Registra el primer fallo y cancela el trabajo restante (una sola vez). */
  const firstFailure = async (err: unknown): Promise<void> => {
    if (firstError !== null) return;
    firstError = err;
    aborted = true;
    if (options.onCancel && !cancelStarted) {
      cancelStarted = true;
      try {
        await options.onCancel();
      } catch {
        // El cancel no enmascara el error original
      }
    }
  };

  async function worker(): Promise<void> {
    while (!aborted && nextIndex < items.length) {
      const index = nextIndex++;
      // Invariante del while: items[index] siempre existe (el guard es defensivo)
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
  // Los workers ya no rechazan: capturan su error en firstError y salen
  await Promise.all(workers);
  if (firstError !== null) throw firstError;
  return results;
}
