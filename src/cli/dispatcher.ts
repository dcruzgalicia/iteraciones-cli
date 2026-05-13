import { build } from '../builder/orchestrator.js';
import { ConfigError, PandocError } from '../errors.js';

export async function runBuild(cwd: string): Promise<void> {
  try {
    await build(cwd);
  } catch (err) {
    if (err instanceof PandocError) {
      process.stderr.write(`Error de pandoc en "${err.sourcePath}": ${err.message}\n`);
      if (err.stderr) process.stderr.write(`${err.stderr}\n`);
    } else if (err instanceof ConfigError) {
      process.stderr.write(`Error de configuración en "${err.configPath}": ${err.message}\n`);
    } else if (err instanceof Error) {
      process.stderr.write(`Error: ${err.message}\n`);
    } else {
      process.stderr.write('Error desconocido durante el build.\n');
    }
    process.exit(1);
  }
}

// stub: implementado en issue #60
export async function runClean(): Promise<void> {}

// stub: implementado en issue #60
export async function runInfo(): Promise<void> {}
