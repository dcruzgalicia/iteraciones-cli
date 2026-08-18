import { join } from 'node:path';
import { ConfigError, formatUserError } from '../lib/errors.js';
import { parseYamlWithPosition } from '../lib/frontmatter.js';
import { logWarning } from '../lib/logger.js';
import { type SiteConfig, SiteConfigSchema } from './config-schema.js';

const CONFIG_FILE = 'iteraciones.config.yaml';

export async function loadSiteConfig(cwd: string): Promise<SiteConfig> {
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
    // El nombre del archivo lo antepone el caller (validate/doctor muestran
    // el path como prefijo): incluirlo aquí duplicaría "iteraciones.config.yaml:".
    throw new ConfigError(`Error de sintaxis: ${formatUserError(yamlResult.error)}`, configPath);
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

  // Errores duros: las claves desconocidas (issues unrecognized_keys de los
  // esquemas strict) y los errores de tipo rompen el build y validate con el
  // mismo mensaje (contrato registrado en docs/architecture.md). El schema es
  // la única fuente de verdad de las claves válidas — no hay listas paralelas
  // que sincronizar ni fallbacks.
  const result = SiteConfigSchema.safeParse(root);
  if (!result.success) {
    const unknownKeyIssues = result.error.issues.filter((issue) => issue.code === 'unrecognized_keys');
    if (unknownKeyIssues.length > 0) {
      const details = unknownKeyIssues
        .map((issue) => {
          const path = issue.path.length > 0 ? `"${issue.path.join('.')}"` : 'la raíz';
          const keys = issue.keys.map((k) => `"${k}"`).join(', ');
          return `en ${path}: ${keys}`;
        })
        .join('; ');
      throw new ConfigError(`claves desconocidas: ${details}`, configPath);
    }
    // Reportar TODOS los errores de tipo en una sola ejecución (antes solo el
    // primero: el usuario iteraba una vez por error en validate).
    const details = result.error.issues
      .map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join('.') : 'config';
        return `${path}: ${issue.message}`;
      })
      .join('; ');
    throw new ConfigError(details, configPath);
  }

  const config = result.data as SiteConfig;

  return config;
}
