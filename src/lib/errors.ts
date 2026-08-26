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
  /** Código estructural opcional: clasificación del error sin matchear texto (#2074). */
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'BuildError';
    this.code = code;
  }
}

/** Códigos estructurales de BuildError usados por la CLI para decidir hints. */
export const BUILD_ERROR_CODES = {
  /** Sintaxis YAML del frontmatter inválida: el detalle completo lo da validate. */
  frontmatterSyntax: 'frontmatter-syntax',
} as const;

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
 *
 * `missingHint` distingue el ENOENT por contexto: al leer un documento del
 * usuario, el motivo habitual es un nombre mal escrito o un archivo que nunca
 * existió (no una eliminación durante el build), así que el call site pasa la
 * sugerencia "verifica el nombre" y el mensaje deja de suponer culpa del
 * build; las rutas de sistema (logo, recursos) conservan el texto actual.
 */
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
