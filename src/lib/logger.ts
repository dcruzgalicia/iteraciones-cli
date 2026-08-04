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
 * Escribe un mensaje de advertencia en stderr.
 * Formato: ⚠ [contexto] mensaje
 */
export function logWarning(message: string, context?: string): void {
  const prefix = context ? `[${context}] ` : '';
  process.stderr.write(`⚠ ${prefix}${message}\n`);
}

/**
 * Escribe un mensaje informativo en stdout.
 * Formato: [contexto] mensaje
 */
export function logInfo(message: string, context?: string): void {
  const prefix = context ? `${context}: ` : '';
  process.stdout.write(`${prefix}${message}\n`);
}

/**
 * Escribe un mensaje de éxito en stdout.
 * Formato: ✓ [contexto] mensaje
 */
export function logSuccess(message: string, context?: string): void {
  const prefix = context ? `${context}: ` : '';
  process.stdout.write(`✓ ${prefix}${message}\n`);
}
