import { access, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { resolveTemplatePath } from '../builder/classifier/resolve-template.js';
import { VALID_TYPES } from '../builder/pipeline/type-graph.js';
import { VALID_REGIONS } from '../builder/types.js';
import { loadSiteConfig as loadConfig, loadSiteConfig } from '../config/config-loader.js';
import { IGNORED_DIRS } from '../constants.js';
import { ConfigError } from '../errors.js';
import { FRONTMATTER_RE, parseFrontmatter } from '../loader/frontmatter.js';

type ValidationError = { file: string; message: string };

async function validateConfig(cwd: string): Promise<ValidationError[]> {
  const errors: ValidationError[] = [];
  try {
    const config = await loadSiteConfig(cwd);
    // Advertir sobre accent desconocido está manejado en loadSiteConfig;
    // aquí reportamos advertencias que antes iban silenciosamente a console.warn.
    // (loadSiteConfig ya usa process.stderr.write tras Fase 2a)
    void config;
  } catch (err) {
    if (err instanceof ConfigError) {
      errors.push({ file: relative(cwd, err.configPath), message: err.message });
    } else {
      errors.push({ file: '_iteraciones.yaml', message: err instanceof Error ? err.message : String(err) });
    }
  }
  return errors;
}

async function validateFrontmatter(cwd: string): Promise<ValidationError[]> {
  const errors: ValidationError[] = [];

  // Cargar la config para obtener el tema (necesario para resolver templates).
  let theme: string | undefined;
  try {
    const config = await loadConfig(cwd);
    theme = config.theme;
  } catch {
    // Si la config falla, se valida sin tema.
  }

  const entries: string[] = [];
  for await (const entry of new Bun.Glob('**/*.md').scan({ cwd })) {
    const first = entry.split('/')[0];
    if (first && IGNORED_DIRS.has(first)) continue;
    entries.push(entry);
  }
  // Ordenar para salida determinista independiente del sistema de archivos.
  entries.sort();

  for (const entry of entries) {
    const absPath = join(cwd, entry);
    let raw: string;
    try {
      raw = await readFile(absPath, 'utf8');
    } catch (err) {
      errors.push({ file: entry, message: `no se pudo leer: ${err instanceof Error ? err.message : String(err)}` });
      continue;
    }

    const match = FRONTMATTER_RE.exec(raw);
    if (!match) continue; // sin frontmatter → válido (type: 'file' por defecto)

    // Validar sintaxis YAML y normalizar el frontmatter en un solo paso.
    let parsed: Record<string, unknown>;
    let fm: ReturnType<typeof parseFrontmatter>['frontmatter'];
    try {
      const result = Bun.YAML.parse(match[1] ?? '');
      if (!result || typeof result !== 'object' || Array.isArray(result)) {
        errors.push({ file: entry, message: 'frontmatter YAML inválido: debe ser un objeto' });
        continue;
      }
      parsed = result as Record<string, unknown>;
      fm = parseFrontmatter(raw).frontmatter;
    } catch (err) {
      errors.push({ file: entry, message: `frontmatter YAML inválido: ${err instanceof Error ? err.message : String(err)}` });
      continue;
    }

    // ── Validación semántica ────────────────────────────────────────────────

    // type: debe ser un DocumentType válido si está declarado
    if (fm.type && !VALID_TYPES.has(fm.type as Parameters<typeof VALID_TYPES.has>[0])) {
      errors.push({
        file: entry,
        message: `type: "${fm.type}" no es un tipo válido. Valores permitidos: ${[...VALID_TYPES].join(', ')}`,
      });
    }

    // region: en bloques debe ser un Region válido
    if (fm.block && fm.region && !VALID_REGIONS.has(fm.region as Parameters<typeof VALID_REGIONS.has>[0])) {
      errors.push({
        file: entry,
        message: `region: "${fm.region}" no es una región válida. Valores permitidos: ${[...VALID_REGIONS].join(', ')}`,
      });
    }

    // block: true sin region es una advertencia (seguirá funcionando con region vacía)
    if (fm.block && !fm.region) {
      errors.push({ file: entry, message: 'block: true pero region: no está definido. El bloque no se insertará en ninguna región del layout' });
    }

    // items: en colecciones deben apuntar a archivos existentes
    const effectiveType = fm.type && VALID_TYPES.has(fm.type as Parameters<typeof VALID_TYPES.has>[0]) ? fm.type : 'file';
    if (effectiveType === 'collection' && fm.items.length > 0) {
      for (const item of fm.items) {
        const itemPath = join(cwd, item.endsWith('.md') ? item : `${item}.md`);
        const itemExists = await access(itemPath)
          .then(() => true)
          .catch(() => false);
        if (!itemExists) {
          // Intentar también sin el .md añadido (puede que el usuario ya lo puso)
          const itemPathRaw = join(cwd, item);
          const itemExistsRaw = await access(itemPathRaw)
            .then(() => true)
            .catch(() => false);
          if (!itemExistsRaw) {
            errors.push({ file: entry, message: `items: "${item}" no existe en el proyecto` });
          }
        }
      }
    }

    // template: si está declarado, debe existir en disco
    if (typeof parsed.template === 'string' && parsed.template) {
      const templatePath = join(cwd, parsed.template);
      const templateExists = await access(templatePath)
        .then(() => true)
        .catch(() => false);
      if (!templateExists) {
        errors.push({ file: entry, message: `template: "${parsed.template}" no existe en el proyecto` });
      }
    }

    // Validar que el template resuelto automáticamente existe
    // (solo si no hay template explícito)
    if (!parsed.template && fm.type && VALID_TYPES.has(fm.type as Parameters<typeof VALID_TYPES.has>[0])) {
      const resolvedTemplate = resolveTemplatePath(fm.type as Parameters<typeof VALID_TYPES.has>[0], theme, cwd);
      const templateExists = await access(resolvedTemplate)
        .then(() => true)
        .catch(() => false);
      if (!templateExists) {
        errors.push({
          file: entry,
          message: `no se encontró el template para type: "${fm.type}" (buscado en: ${resolvedTemplate}). Ejecuta "iteraciones doctor" para verificar los templates`,
        });
      }
    }
  }
  return errors;
}

/**
 * Valida la configuración del proyecto y el frontmatter de los ficheros Markdown.
 * Incluye validación semántica: tipos, regiones, items de colecciones y templates.
 * No ejecuta la compilación completa.
 */
export async function runValidate(cwd: string): Promise<void> {
  const [configErrors, frontmatterErrors] = await Promise.all([validateConfig(cwd), validateFrontmatter(cwd)]);
  const errors = [...configErrors, ...frontmatterErrors];

  if (errors.length === 0) {
    process.stdout.write('validate: sin errores.\n');
    return;
  }

  process.stderr.write(`validate: se encontraron ${errors.length} error(es):\n`);
  for (const e of errors) {
    process.stderr.write(`  ✖ ${e.file}: ${e.message}\n`);
  }
  process.exitCode = 1;
}
