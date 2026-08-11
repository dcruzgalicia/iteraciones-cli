import { join } from 'node:path';
import type { ZodIssue } from 'zod';
import { ConfigError, formatUserError } from '../lib/errors.js';
import { parseYamlWithPosition } from '../lib/frontmatter.js';
import { logWarning } from '../lib/logger.js';
import { KNOWN_ACCENT_COLORS, type SiteConfig, SiteConfigSchema } from './config-schema.js';

const CONFIG_FILE = 'iteraciones.config.yaml';

/**
 * Elimina del objeto crudo las claves desconocidas reportadas por los issues
 * de `unrecognized_keys` de los esquemas strict, para poder re-parsear y
 * obtener el valor con defaults aplicados. No modifica el valor original.
 */
function removeUnknownKeys(value: unknown, issues: ZodIssue[]): unknown {
  const unknownIssues = issues.filter((issue) => issue.code === 'unrecognized_keys');
  if (unknownIssues.length === 0) return value;

  const result = structuredClone(value);
  for (const issue of unknownIssues) {
    let target: unknown = result;
    for (const segment of issue.path) {
      if (typeof target !== 'object' || target === null) {
        target = undefined;
        break;
      }
      // Los paths de unrecognized_keys solo contienen claves (string) e índices (number)
      target = (target as Record<string | number, unknown>)[segment as string | number];
    }
    if (typeof target === 'object' && target !== null && !Array.isArray(target)) {
      for (const key of issue.keys) {
        delete (target as Record<string, unknown>)[key];
      }
    }
  }
  return result;
}

export async function loadSiteConfig(cwd: string, options?: { mode?: 'build' | 'validate' }): Promise<SiteConfig> {
  const isValidate = options?.mode === 'validate';
  const configPath = join(cwd, CONFIG_FILE);
  const file = Bun.file(configPath);

  if (!(await file.exists())) {
    return SiteConfigSchema.parse({}) as SiteConfig;
  }

  let raw: string;
  try {
    raw = await file.text();
  } catch (err) {
    throw new ConfigError(`No se pudo leer ${CONFIG_FILE}: ${String(err)}`, configPath);
  }

  let parsed: unknown;
  const yamlResult = parseYamlWithPosition(raw);
  if (yamlResult.error) {
    throw new ConfigError(`Error de sintaxis en ${CONFIG_FILE}: ${formatUserError(yamlResult.error)}`, configPath);
  }
  parsed = yamlResult.value;

  if (!parsed || typeof parsed !== 'object') {
    // Un archivo vacío (null) es equivalente a defaults, sin aviso; una config
    // con forma de escalar o lista se ignoraba en silencio: warning explícito.
    if (parsed !== null && parsed !== undefined) {
      logWarning('iteraciones.config.yaml no es un objeto YAML (se esperaba un mapa); se usan los valores por defecto', 'config');
    }
    return SiteConfigSchema.parse({}) as SiteConfig;
  }

  const root = parsed as Record<string, unknown>;

  // Advertir sobre accent inválido: en build es fallback a "lime" con warning
  // (el esquema Zod ya no aplica .catch()). En modo validate NO se corta aquí:
  // el schema lo reporta como issue junto a los demás errores.
  const htmlRaw = (root.format as Record<string, unknown> | undefined)?.html;
  const accentRaw = (htmlRaw as Record<string, unknown> | undefined)?.accent;
  if (typeof accentRaw === 'string' && !KNOWN_ACCENT_COLORS.includes(accentRaw as (typeof KNOWN_ACCENT_COLORS)[number])) {
    if (!isValidate) {
      // logWarning pasa por el sink del tracker: en builds TTY el warning se
      // difiere al resumen (antes escribía a stderr directo e interrumpía el render).
      logWarning(`color de acento desconocido: "${accentRaw}". Usando "lime" por defecto.`, 'config');
      (root.format as Record<string, unknown>).html = { ...((htmlRaw as Record<string, unknown>) ?? {}), accent: 'lime' };
    }
  }

  // Las claves desconocidas (issues unrecognized_keys de los esquemas strict)
  // son warnings, no errores: el build continúa. Los errores de tipo sí rompen.
  const result = SiteConfigSchema.safeParse(root);
  if (!result.success) {
    const unknownKeyIssues = result.error.issues.filter((issue) => issue.code === 'unrecognized_keys');
    if (unknownKeyIssues.length > 0) {
      if (isValidate) {
        const details = unknownKeyIssues
          .map((issue) => {
            const path = issue.path.length > 0 ? `"${issue.path.join('.')}"` : 'la raíz';
            const keys = issue.keys.map((k) => `"${k}"`).join(', ');
            return `en ${path}: ${keys}`;
          })
          .join('; ');
        throw new ConfigError(`claves desconocidas: ${details}`, configPath);
      }
      for (const issue of unknownKeyIssues) {
        const path = issue.path.length > 0 ? `"${issue.path.join('.')}"` : 'la raíz';
        const keys = issue.keys.map((k) => `"${k}"`).join(', ');
        logWarning(`iteraciones.config.yaml: claves sin efecto en ${path}: ${keys}. Revisa docs/configuration.md`, 'config');
      }
    }
    const realIssues = result.error.issues.filter((issue) => issue.code !== 'unrecognized_keys');
    if (realIssues.length > 0) {
      // Reportar TODOS los errores de tipo en una sola ejecución (antes solo el
      // primero: el usuario iteraba una vez por error en validate).
      const details = realIssues
        .map((issue) => {
          const path = issue.path.length > 0 ? issue.path.join('.') : 'config';
          return `${path}: ${issue.message}`;
        })
        .join('; ');
      throw new ConfigError(details, configPath);
    }
    // Solo había claves desconocidas: limpiarlas y re-parsear para obtener defaults
    const retry = SiteConfigSchema.safeParse(removeUnknownKeys(root, result.error.issues));
    if (!retry.success) {
      const first = retry.error.issues[0];
      throw new ConfigError(`${first?.path.join('.') ?? ''}: ${first?.message ?? 'Error de validación'}`, configPath);
    }
    return retry.data as SiteConfig;
  }

  const config = result.data as SiteConfig;

  return config;
}
