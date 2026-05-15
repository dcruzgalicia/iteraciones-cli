import { build } from '../builder/orchestrator.js';
import { ConfigError, PandocError } from '../errors.js';
import { runServe as serve } from './serve.js';

export async function runBuild(cwd: string): Promise<void> {
  try {
    await build(cwd);
  } catch (err) {
    if (err instanceof PandocError) {
      const location = err.sourcePath ? ` en "${err.sourcePath}"` : '';
      process.stderr.write(`Error de pandoc${location}: ${err.message}\n`);
      if (err.stderr) process.stderr.write(`${err.stderr}\n`);
    } else if (err instanceof ConfigError) {
      process.stderr.write(`Error de configuración en "${err.configPath}": ${err.message}\n`);
    } else if (err instanceof Error) {
      process.stderr.write(`Error: ${err.message}\n`);
    } else {
      process.stderr.write('Error desconocido durante el build.\n');
    }
    // Asignar exitCode en lugar de llamar process.exit() directamente permite
    // que el event loop drene los streams antes de que el proceso termine.
    process.exitCode = 1;
  }
}

// stub: implementado en issue #60
export async function runClean(): Promise<void> {}

// stub: implementado en issue #60
export async function runInfo(): Promise<void> {}

export async function runServe(cwd: string, port: number): Promise<void> {
  try {
    await serve(cwd, port);
    // runServe resuelve cuando el servidor está escuchando; el proceso continúa
    // hasta recibir SIGINT/SIGTERM para mantener el servidor activo.
  } catch (err) {
    if (err instanceof Error) {
      process.stderr.write(`Error: ${err.message}\n`);
    } else {
      process.stderr.write('Error desconocido al arrancar el servidor.\n');
    }
    process.exitCode = 1;
  }
}
