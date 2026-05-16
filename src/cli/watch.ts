import { build } from '../builder/orchestrator.js';
import { ConfigError, PandocError } from '../errors.js';
import { startWatcher } from './watcher.js';

/**
 * Ejecuta un build inicial y después observa cambios en `cwd`, disparando
 * rebuilds incrementales sin arrancar un servidor HTTP.
 *
 * Retorna una función que detiene el watcher al ser llamada.
 */
export async function runWatch(cwd: string, options: { verbose?: boolean } = {}): Promise<() => void> {
  const log = (msg: string): void => void process.stdout.write(`${msg}\n`);

  log('watch: build inicial…');
  await build(cwd, { verbose: options.verbose });
  log('watch: listo — observando cambios…');

  const stopWatcher = startWatcher(cwd, async (filename) => {
    log(`watch: cambio detectado en "${filename}" — reconstruyendo…`);
    try {
      await build(cwd, { verbose: options.verbose });
      log('watch: rebuild completado.');
    } catch (err) {
      // Los errores de rebuild se reportan pero no detienen el watcher.
      if (err instanceof PandocError) {
        const location = err.sourcePath ? ` en "${err.sourcePath}"` : '';
        process.stderr.write(`watch: error de pandoc${location}: ${err.message}\n`);
      } else if (err instanceof ConfigError) {
        process.stderr.write(`watch: error de configuración: ${err.message}\n`);
      } else if (err instanceof Error) {
        process.stderr.write(`watch: error: ${err.message}\n`);
      } else {
        process.stderr.write('watch: error desconocido durante el rebuild.\n');
      }
    }
  });

  return stopWatcher;
}
