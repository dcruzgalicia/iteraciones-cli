import { join } from 'node:path';
import { ConfigError, formatUserError } from '../lib/errors.js';
import { parseYamlWithPosition } from '../lib/frontmatter.js';
import { logWarning } from '../lib/logger.js';
import { type SiteConfig, SiteConfigSchema } from './config-schema.js';

const CONFIG_FILE = 'iteraciones.config.yaml';

type PresentKeyPaths = ReadonlySet<string>;

interface LoadedSiteConfig {
  config: SiteConfig;
  presentKeys: PresentKeyPaths;
}

function collectPresentKeys(value: unknown, prefix: string, out: Set<string>): void {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    out.add(path);
    collectPresentKeys(child, path, out);
  }
}

export async function loadSiteConfigWithPresence(cwd: string): Promise<LoadedSiteConfig> {
  const configPath = join(cwd, CONFIG_FILE);
  const file = Bun.file(configPath);

  if (!(await file.exists())) {
    throw new ConfigError(
      "falta el archivo de configuración del proyecto; ejecuta 'iteraciones init' para crearlo (un archivo vacío usa los valores por defecto)",
      configPath,
    );
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
    throw new ConfigError(`Error de sintaxis: ${formatUserError(yamlResult.error)}`, configPath);
  }
  parsed = yamlResult.value;

  if (!parsed || typeof parsed !== 'object') {
    if (parsed !== null && parsed !== undefined) {
      logWarning('iteraciones.config.yaml no es un objeto YAML (se esperaba un mapa); se usan los valores por defecto', 'config');
    }
    return { config: SiteConfigSchema.parse({}), presentKeys: new Set() };
  }

  const root = parsed as Record<string, unknown>;
  const presentKeys = new Set<string>();
  collectPresentKeys(root, '', presentKeys);

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
    const details = result.error.issues
      .map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join('.') : 'config';
        return `${path}: ${issue.message}`;
      })
      .join('; ');
    throw new ConfigError(details, configPath);
  }

  return { config: result.data, presentKeys };
}

export async function loadSiteConfig(cwd: string): Promise<SiteConfig> {
  return (await loadSiteConfigWithPresence(cwd)).config;
}

export async function loadSiteConfigIfPresent(cwd: string): Promise<LoadedSiteConfig | null> {
  if (!(await Bun.file(join(cwd, CONFIG_FILE)).exists())) return null;
  return loadSiteConfigWithPresence(cwd);
}
