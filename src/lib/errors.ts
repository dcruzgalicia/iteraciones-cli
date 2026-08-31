export class ConversionError extends Error {
  public readonly code?: string;

  constructor(
    message: string,
    public readonly sourcePath: string,
    public readonly stderr: string,
    code?: string,
  ) {
    super(message);
    this.name = 'ConversionError';
    this.code = code;
  }
}

export class PandocError extends ConversionError {
  constructor(message: string, sourcePath: string, stderr: string, code?: string) {
    super(message, sourcePath, stderr, code);
    this.name = 'PandocError';
  }
}

export class ExportError extends ConversionError {
  constructor(message: string, sourcePath: string, stderr: string, code?: string) {
    super(message, sourcePath, stderr, code);
    this.name = 'ExportError';
  }
}

export const PANDOC_ERROR_CODES = {
  envMissing: 'env-missing',
} as const;

export class ConfigError extends Error {
  constructor(
    message: string,
    public readonly configPath: string,
  ) {
    super(message);
    this.name = 'ConfigError';
  }
}

export class BuildError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'BuildError';
    this.code = code;
  }
}

export const BUILD_ERROR_CODES = {
  frontmatterSyntax: 'frontmatter-syntax',
} as const;

const KNOWN_ERROR_PREFIXES = [
  'SyntaxError',
  'YAMLException',
  'TypeError',
  'ConfigError',
  'BuildError',
  'PandocError',
  'ExportError',
  'ConversionError',
  'Error',
];

export function formatUserError(err: unknown): string {
  if (err instanceof Error) {
    let msg = err.message;
    for (const prefix of KNOWN_ERROR_PREFIXES) {
      if (msg.startsWith(`${prefix}: `)) {
        msg = msg.slice(prefix.length + 2);
        break;
      }
    }
    return msg;
  }
  return String(err);
}

export function translateSystemError(err: unknown, missingHint?: string): string {
  if (err instanceof Error) {
    if ('code' in err) {
      const code = (err as NodeJS.ErrnoException).code;
      switch (code) {
        case 'EACCES':
          return 'sin permisos de lectura';
        case 'ENOENT':
          return missingHint === undefined
            ? 'archivo no encontrado (posiblemente eliminado durante el build)'
            : `archivo no encontrado: ${missingHint}`;
        case 'EISDIR':
          return 'es un directorio, no un archivo';
        case 'ENOTDIR':
          return 'una ruta intermedia no es un directorio';
        case 'EMFILE':
          return 'demasiados archivos abiertos; reduce la concurrencia o cierra otros programas';
        default:
          return err.message;
      }
    }
    return err.message;
  }
  return String(err);
}
