import { ConfigError, PandocError } from '../errors.js';

/**
 * Reporta un error de rebuild en stderr con formato legible.
 * Centraliza el manejo de PandocError, ConfigError y errores genéricos
 * para evitar duplicación entre los comandos serve y watch.
 *
 * @param err    El error capturado (unknown para compatibilidad con catch).
 * @param prefix Prefijo del comando que muestra el error ("serve" | "watch").
 */
export function reportBuildError(err: unknown, prefix: string): void {
  if (err instanceof PandocError) {
    const location = err.sourcePath ? ` en "${err.sourcePath}"` : '';
    process.stderr.write(`${prefix}: error de pandoc${location}: ${err.message}\n`);
    if (err.stderr) process.stderr.write(`${err.stderr}\n`);
  } else if (err instanceof ConfigError) {
    process.stderr.write(`${prefix}: error de configuración: ${err.message}\n`);
  } else if (err instanceof Error) {
    process.stderr.write(`${prefix}: error en rebuild — ${err.message}\n`);
  } else {
    process.stderr.write(`${prefix}: error desconocido durante el rebuild.\n`);
  }
}
