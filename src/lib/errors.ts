export class PandocError extends Error {
  constructor(
    message: string,
    public readonly sourcePath: string,
    public readonly stderr: string,
  ) {
    super(message);
    this.name = 'PandocError';
  }
}

export class ConfigError extends Error {
  constructor(
    message: string,
    public readonly configPath: string,
  ) {
    super(message);
    this.name = 'ConfigError';
  }
}

/**
 * Error del pipeline de build con contexto de documento (frontmatter inválido,
 * etc.). El dispatcher lo reporta con el prefijo [build].
 */
export class BuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BuildError';
  }
}

/**
 * Normaliza un mensaje de error para el usuario: elimina prefijos de clase
 * (SyntaxError:, Error:) y ruido interno como stacks o causas.
 * Los errores de YAML se traducen a formato legible.
 */
export function formatUserError(err: unknown): string {
  if (err instanceof Error) {
    let msg = err.message;
    // Eliminar prefijos de clase: "SyntaxError: ...", "Error: ..."
    msg = msg.replace(/^\w*Error:\s*/, '');
    // Eliminar nombres de funciones internas (p.ej. "clean()")
    // y otros detalles de implementación
    return msg;
  }
  return String(err);
}
