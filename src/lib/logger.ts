import { styleText } from 'node:util';

export const GLYPHS = {
  success: '✔',
  error: '✖',
  warning: '⚠',
  info: 'ℹ',
  skipped: '–',
} as const;

function colorize(text: string, color: 'green' | 'red' | 'yellow' | 'dim', stream: NodeJS.WriteStream): string {
  if (process.env.NO_COLOR !== undefined) return text;
  return styleText(color, text, { validateStream: true, stream });
}

function formatContext(context: string | undefined, stream: NodeJS.WriteStream): string {
  return context ? colorize(`[${context}] `, 'dim', stream) : '';
}

export function logError(message: string, context?: string): void {
  const prefix = formatContext(context, process.stderr);
  process.stderr.write(`${colorize(GLYPHS.error, 'red', process.stderr)} ${prefix}${message}\n`);
}

export function fail(context: string, err: unknown): void {
  logError(err instanceof Error ? err.message : String(err), context);
  process.exitCode = 1;
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

export function logInfo(message: string, context?: string, stream: NodeJS.WriteStream = process.stdout): void {
  const prefix = formatContext(context, stream);
  stream.write(`${colorize(GLYPHS.info, 'dim', stream)} ${prefix}${message}\n`);
}

export function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

export function logSuccess(message: string, context?: string): void {
  const prefix = formatContext(context, process.stdout);
  process.stdout.write(`${colorize(GLYPHS.success, 'green', process.stdout)} ${prefix}${message}\n`);
}
