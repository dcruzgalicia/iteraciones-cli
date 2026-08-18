import { join } from 'node:path';
import { ConfigError, formatUserError } from '../lib/errors.js';
import { parseYamlWithPosition } from '../lib/frontmatter.js';
import { logWarning } from '../lib/logger.js';
import { type SiteConfig, SiteConfigSchema } from './config-schema.js';

const CONFIG_FILE = 'iteraciones.config.yaml';

/**
 * Rutas punteadas de las claves realmente escritas en el YAML del usuario
 * (p. ej. `format.pdf.disabled-preamble-filters`), antes de que el schema
 * materialice los defaults. API interna del módulo de configuración: permite
 * distinguir "clave no configurada" de "clave configurada con el valor por
 * defecto" (ambiguas al leer solo el SiteConfig materializado).
 */
export type PresentKeyPaths = ReadonlySet<string>;

export interface LoadedSiteConfig {
  /** Configuración validada, con defaults materializados por el schema Zod. */
  config: SiteConfig;
  /** Rutas punteadas de las claves presentes en el YAML crudo del usuario. */
  presentKeys: PresentKeyPaths;
}

/** Recoge rutas punteadas de las claves presentes recorriendo el objeto crudo. */
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
    return { config: SiteConfigSchema.parse({}) as SiteConfig, presentKeys: new Set() };
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
    return { config: SiteConfigSchema.parse({}) as SiteConfig, presentKeys: new Set() };
  }

  const root = parsed as Record<string, unknown>;
  // Presencia sobre el objeto crudo: el schema materializa defaults al validar
  // y ya no se podría distinguir qué escribió el usuario.
  const presentKeys = new Set<string>();
  collectPresentKeys(root, '', presentKeys);

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

  return { config: result.data as SiteConfig, presentKeys };
}

/** Carga y valida la configuración con los defaults materializados (API pública). */
export async function loadSiteConfig(cwd: string): Promise<SiteConfig> {
  return (await loadSiteConfigWithPresence(cwd)).config;
}
