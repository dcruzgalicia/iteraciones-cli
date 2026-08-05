/**
 * Funciones helper para mensajes en terminal.
 * Unifica el formato de errores, warnings e información.
 */

/**
 * Escribe un mensaje de error en stderr.
 * Formato: ✖ [contexto] mensaje
 */
export function logError(message: string, context?: string): void {
  const prefix = context ? `[${context}] ` : '';
  process.stderr.write(`✖ ${prefix}${message}\n`);
}

/**
 * Sink opcional para diferir warnings: cuando el ProgressTracker esta activo
 * (modo no verbose), los warnings se acumulan y se muestran en el resumen
 * final en lugar de emitirse en tiempo real (que interferiria con listr2).
 */
let warningSink: ((message: string) => void) | null = null;

export function setWarningSink(sink: ((message: string) => void) | null): void {
  warningSink = sink;
}

/**
 * Escribe un mensaje de advertencia en stderr.
 * Formato: ⚠ [contexto] mensaje
 */
export function logWarning(message: string, context?: string): void {
  const prefix = context ? `[${context}] ` : '';
  const formatted = `⚠ ${prefix}${message}`;
  if (warningSink) {
    warningSink(formatted);
  } else {
    process.stderr.write(`${formatted}\n`);
  }
}

/**
 * Escribe un mensaje informativo en stdout.
 * Formato: [contexto] mensaje
 */
export function logInfo(message: string, context?: string): void {
  const prefix = context ? `[${context}] ` : '';
  process.stdout.write(`${prefix}${message}\n`);
}

/**
 * Escribe un mensaje de éxito en stdout.
 * Formato: ✓ [contexto] mensaje
 */
export function logSuccess(message: string, context?: string): void {
  const prefix = context ? `[${context}] ` : '';
  process.stdout.write(`✓ ${prefix}${message}\n`);
}
