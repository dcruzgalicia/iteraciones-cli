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

/**
 * Glifos unificados de toda la CLI (logger, tracker de progreso y doctor):
 * una sola familia de símbolos de estado. El éxito es ✔ (U+2714) en todas
 * partes (antes logger usaba ✓ y el tracker ✔).
 */
export const GLYPHS = {
  success: '✔',
  error: '✖',
  warning: '⚠',
  info: 'ℹ',
  skipped: '–',
} as const;

/**
 * Override de la colorización para tests: `false` fuerza salida sin ANSI
 * aunque el stream sea un TTY (la suite aserta strings exactos).
 * `undefined` = decisión por TTY (comportamiento normal).
 */
let colorEnabledOverride: boolean | undefined;

export function setLoggerColorEnabled(enabled: boolean): void {
  colorEnabledOverride = enabled;
}

/** ¿El stream es un TTY? Solo en TTY se emiten colores (pipes/CI limpios). */
const isTty = (stream: NodeJS.WriteStream): boolean => stream.isTTY === true;

/**
 * Convención NO_COLOR (https://no-color.org): su presencia desactiva los
 * colores aunque el stream sea TTY. Los códigos de control del tracker
 * (cursor) se rigen por TTY, no por NO_COLOR.
 */
const noColorRequested = (): boolean => process.env.NO_COLOR !== undefined;

/** Envuelve texto con un color ANSI solo si el stream es un TTY y sin NO_COLOR. */
function colorize(text: string, color: AnsiColor, stream: NodeJS.WriteStream): string {
  const colored = isTty(stream) && colorEnabledOverride !== false && !noColorRequested();
  return colored ? `${ANSI[color]}${text}${ANSI.reset}` : text;
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
  process.stderr.write(`${colorize(GLYPHS.error, 'red', process.stderr)} ${prefix}${message}\n`);
}

/**
 * Sink opcional para diferir warnings: cuando el ProgressTracker esta activo
 * (modo no verbose), los warnings se acumulan y se muestran en el resumen
 * final en lugar de emitirse en tiempo real (que interferiría con el render).
 *
 * El estado solo se modifica desde runWithWarningSink: el sink se configura
 * antes de ejecutar la función y se restaura en un finally, sin estado global
 * que escape del scope de ejecución.
 */
let warningSink: ((message: string) => void) | null = null;

/**
 * Ejecuta `fn` con el sink de warnings activo: los logWarning emitidos durante
 * la ejecución se envían al sink en lugar de stderr. El sink se restaura
 * siempre (try/finally), incluso si `fn` lanza.
 */
export async function runWithWarningSink<T>(sink: (message: string) => void, fn: () => Promise<T>): Promise<T> {
  const previous = warningSink;
  warningSink = sink;
  try {
    return await fn();
  } finally {
    warningSink = previous;
  }
}

/**
 * Escribe un mensaje de advertencia en stderr.
 * Formato: ⚠ [contexto] mensaje
 */
export function logWarning(message: string, context?: string): void {
  const prefix = formatContext(context, process.stderr);
  const formatted = `${colorize(GLYPHS.warning, 'yellow', process.stderr)} ${prefix}${message}`;
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
  process.stdout.write(`${colorize(GLYPHS.info, 'dim', process.stdout)} ${prefix}${message}\n`);
}

/**
 * Escribe un mensaje de éxito en stdout.
 * Formato: ✔ [contexto] mensaje
 */
export function logSuccess(message: string, context?: string): void {
  const prefix = formatContext(context, process.stdout);
  process.stdout.write(`${colorize(GLYPHS.success, 'green', process.stdout)} ${prefix}${message}\n`);
}
