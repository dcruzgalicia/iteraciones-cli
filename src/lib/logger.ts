/**
 * Funciones helper para mensajes en terminal.
 * Unifica el formato de errores, warnings e información.
 */

// ── Colores ANSI ────────────────────────────────────────────────────────────

const ANSI = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  dim: '\x1b[2m',
  reset: '\x1b[0m',
} as const;

type AnsiColor = keyof typeof ANSI;

/** ¿El stream es un TTY? Solo en TTY se emiten colores (pipes/CI limpios). */
const isTty = (stream: NodeJS.WriteStream): boolean => stream.isTTY === true;

/** Envuelve texto con un color ANSI solo si el stream es un TTY. */
function colorize(text: string, color: AnsiColor, stream: NodeJS.WriteStream): string {
  return isTty(stream) ? `${ANSI[color]}${text}${ANSI.reset}` : text;
}

/** Formatea un prefijo [contexto] en dim (solo TTY). */
function formatContext(context: string | undefined, stream: NodeJS.WriteStream): string {
  return context ? colorize(`[${context}] `, 'dim', stream) : '';
}

/**
 * Escribe un mensaje de error en stderr.
 * Formato: ✖ [contexto] mensaje
 */
export function logError(message: string, context?: string): void {
  const prefix = formatContext(context, process.stderr);
  process.stderr.write(`${colorize('✖', 'red', process.stderr)} ${prefix}${message}\n`);
}

/**
 * Sink opcional para diferir warnings: cuando el ProgressTracker esta activo
 * (modo no verbose), los warnings se acumulan y se muestran en el resumen
 * final en lugar de emitirse en tiempo real (que interferiría con el render).
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
  const prefix = formatContext(context, process.stderr);
  const formatted = `${colorize('⚠', 'yellow', process.stderr)} ${prefix}${message}`;
  if (warningSink) {
    warningSink(formatted);
  } else {
    process.stderr.write(`${formatted}\n`);
  }
}

/**
 * Escribe un mensaje informativo en stdout.
 * Formato: ℹ [contexto] mensaje
 */
export function logInfo(message: string, context?: string): void {
  const prefix = formatContext(context, process.stdout);
  process.stdout.write(`${colorize('ℹ', 'dim', process.stdout)} ${prefix}${message}\n`);
}

/**
 * Escribe un mensaje de éxito en stdout.
 * Formato: ✓ [contexto] mensaje
 */
export function logSuccess(message: string, context?: string): void {
  const prefix = formatContext(context, process.stdout);
  process.stdout.write(`${colorize('✓', 'green', process.stdout)} ${prefix}${message}\n`);
}
