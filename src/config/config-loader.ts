import { join } from 'node:path';
import { ConfigError } from '../lib/errors.js';
import { parseYamlWithPosition } from '../lib/frontmatter.js';
import { logWarning } from '../lib/logger.js';
import { type SiteConfig, SiteConfigSchema } from './config-schema.js';

const CONFIG_FILE = 'iteraciones.config.yaml';

interface LoadedSiteConfig {
  config: SiteConfig;
  wroteDisabledPreamble: boolean;
}

function wroteDisabledPreamble(root: Record<string, unknown>): boolean {
  const format = root.format;
  const pdf = typeof format === 'object' && format !== null ? (format as Record<string, unknown>).pdf : undefined;
  return (
    root.disabledPreambleFilters !== undefined ||
    (typeof pdf === 'object' && pdf !== null && (pdf as Record<string, unknown>).disabledPreambleFilters !== undefined)
  );
}

async function readConfigText(cwd: string): Promise<{ configPath: string; raw: string } | null> {
  const configPath = join(cwd, CONFIG_FILE);
  const file = Bun.file(configPath);
  if (!(await file.exists())) return null;
  try {
    return { configPath, raw: await file.text() };
  } catch (err) {
    throw new ConfigError(`No se pudo leer ${CONFIG_FILE}: ${String(err)}`, configPath);
  }
}

function unknownKeysMessage(issues: { path: (string | number | symbol)[]; keys: string[] }[]): string {
  const details = issues
    .map((issue) => {
      const path = issue.path.length > 0 ? `"${issue.path.join('.')}"` : 'la raíz';
      return `en ${path}: ${issue.keys.map((k) => `"${k}"`).join(', ')}`;
    })
    .join('; ');
  const hints: string[] = [];
  if (issues.some((issue) => issue.path.join('.') === 'format' && issue.keys.includes('script'))) {
    hints.push('"format.script" pasó a "script" (nivel superior): renombra la clave');
  }
  if (issues.some((issue) => issue.path.join('.') === 'format.html' && issue.keys.includes('blocks'))) {
    hints.push('"format.html.blocks" ya no existe: el orden de las tarjetas es fijo');
  }
  return `claves desconocidas: ${details}${hints.length > 0 ? ` — ${hints.join('; ')}` : ''}`;
}

function parseConfig(raw: string, configPath: string): LoadedSiteConfig {
  let parsed: unknown;
  const yamlResult = parseYamlWithPosition(raw);
  if (yamlResult.error) {
    throw new ConfigError(`Error de sintaxis: ${yamlResult.error}`, configPath);
  }
  parsed = yamlResult.value;

  if (!parsed || typeof parsed !== 'object') {
    if (parsed !== null && parsed !== undefined) {
      logWarning('iteraciones.config.yaml no es un objeto YAML (se esperaba un mapa); se usan los valores por defecto', 'config');
    }
    return { config: SiteConfigSchema.parse({}), wroteDisabledPreamble: false };
  }

  const root = parsed as Record<string, unknown>;

  const result = SiteConfigSchema.safeParse(root);
  if (!result.success) {
    const unknownKeyIssues = result.error.issues.filter((issue) => issue.code === 'unrecognized_keys');
    if (unknownKeyIssues.length > 0) throw new ConfigError(unknownKeysMessage(unknownKeyIssues), configPath);
    const details = result.error.issues
      .map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join('.') : 'config';
        return `${path}: ${issue.message}`;
      })
      .join('; ');
    throw new ConfigError(details, configPath);
  }

  return { config: result.data, wroteDisabledPreamble: wroteDisabledPreamble(root) };
}

export async function loadSiteConfig(cwd: string): Promise<SiteConfig> {
  return (await loadSiteConfigIfPresent(cwd))?.config ?? SiteConfigSchema.parse({});
}

export async function loadSiteConfigIfPresent(cwd: string): Promise<LoadedSiteConfig | null> {
  const read = await readConfigText(cwd);
  if (read === null) return null;
  return parseConfig(read.raw, read.configPath);
}
