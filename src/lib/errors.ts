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
 * Prefijos de clase de error conocidos que se eliminan del mensaje.
 * Lista explícita: solo se recorta si el mensaje comienza exactamente
 * con uno de estos prefijos (evita truncar información útil en medio).
 */
const KNOWN_ERROR_PREFIXES = ['SyntaxError', 'YAMLException', 'TypeError', 'ConfigError', 'BuildError', 'Error'];

/**
 * Normaliza un mensaje de error para el usuario: elimina prefijos de clase
 * (SyntaxError:, Error:) y ruido interno como stacks o causas.
 * Los errores de YAML se traducen a formato legible.
 */
export function formatUserError(err: unknown): string {
  if (err instanceof Error) {
    let msg = err.message;
    // Eliminar prefijos de clase conocidos: "SyntaxError: ...", "Error: ..."
    for (const prefix of KNOWN_ERROR_PREFIXES) {
      if (msg.startsWith(`${prefix}: `)) {
        msg = msg.slice(prefix.length + 2);
        break;
      }
    }
    // Eliminar nombres de funciones internas (p.ej. "clean()")
    // y otros detalles de implementación
    return msg;
  }
  return String(err);
}

/**
 * Traduce códigos de error del sistema operativo a mensajes en español
 * accionables. Los códigos crudos (EACCES, ENOENT...) son incomprensibles
 * para usuarios no técnicos; el path se añade en el call site.
 */
export function translateSystemError(err: unknown): string {
  if (err instanceof Error) {
    if ('code' in err) {
      const code = (err as NodeJS.ErrnoException).code;
      switch (code) {
        case 'EACCES':
          return 'sin permisos de lectura';
        case 'ENOENT':
          return 'archivo no encontrado (posiblemente eliminado durante el build)';
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
