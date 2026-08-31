const ANSI = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  dim: '\x1b[2m',
  reset: '\x1b[0m',
} as const;

type AnsiColor = keyof typeof ANSI;

export const GLYPHS = {
  success: '✔',
  error: '✖',
  warning: '⚠',
  info: 'ℹ',
  skipped: '–',
} as const;

let colorEnabledOverride: boolean | undefined;

export function setLoggerColorEnabled(enabled: boolean): void {
  colorEnabledOverride = enabled;
}

const isTty = (stream: NodeJS.WriteStream): boolean => stream.isTTY === true;

const noColorRequested = (): boolean => process.env.NO_COLOR !== undefined;

function colorize(text: string, color: AnsiColor, stream: NodeJS.WriteStream): string {
  const colored = isTty(stream) && colorEnabledOverride !== false && !noColorRequested();
  return colored ? `${ANSI[color]}${text}${ANSI.reset}` : text;
}

function formatContext(context: string | undefined, stream: NodeJS.WriteStream): string {
  return context ? colorize(`[${context}] `, 'dim', stream) : '';
}

export function logError(message: string, context?: string): void {
  const prefix = formatContext(context, process.stderr);
  process.stderr.write(`${colorize(GLYPHS.error, 'red', process.stderr)} ${prefix}${message}\n`);
}

let warningSink: ((message: string) => void) | null = null;

export async function runWithWarningSink<T>(sink: (message: string) => void, fn: () => Promise<T>): Promise<T> {
  const previous = warningSink;
  warningSink = sink;
  try {
    return await fn();
  } finally {
    warningSink = previous;
  }
}

export function logWarning(message: string, context?: string): void {
  const prefix = formatContext(context, process.stderr);
  const formatted = `${colorize(GLYPHS.warning, 'yellow', process.stderr)} ${prefix}${message}`;
  if (warningSink) {
    warningSink(formatted);
  } else {
    process.stderr.write(`${formatted}\n`);
  }
}

export function logInfo(message: string, context?: string): void {
  const prefix = formatContext(context, process.stdout);
  process.stdout.write(`${colorize(GLYPHS.info, 'dim', process.stdout)} ${prefix}${message}\n`);
}

export function logNotice(message: string, context?: string): void {
  const prefix = formatContext(context, process.stderr);
  process.stderr.write(`${colorize(GLYPHS.info, 'dim', process.stderr)} ${prefix}${message}\n`);
}

export function logSuccess(message: string, context?: string): void {
  const prefix = formatContext(context, process.stdout);
  process.stdout.write(`${colorize(GLYPHS.success, 'green', process.stdout)} ${prefix}${message}\n`);
}
