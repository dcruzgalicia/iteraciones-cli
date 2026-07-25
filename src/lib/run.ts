export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function run(command: string, args: string[]): Promise<RunResult> {
  let proc: ReturnType<typeof Bun.spawn>;

  try {
    proc = Bun.spawn([command, ...args], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
  } catch {
    throw new Error(`No se encontró el comando "${command}". Verifica que esté instalado y disponible en PATH.`);
  }

  if (proc.stdout == null || typeof proc.stdout === 'number') {
    throw new Error(`No se pudo leer stdout del comando "${command}".`);
  }

  if (proc.stderr == null || typeof proc.stderr === 'number') {
    throw new Error(`No se pudo leer stderr del comando "${command}".`);
  }

  const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);

  return { stdout, stderr, exitCode };
}
