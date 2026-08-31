import { readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { validateDisabledFilters } from '../builder/filter-resolver.js';
import { listMarkdownDocuments } from '../builder/gitignore.js';
import { resolveEffectiveDisabledPreamble, validateDisabledPreambleFilters, validatePreambleDependencies } from '../builder/preamble-loader.js';
import {
  looseColonLines,
  looseColonsMessage,
  MISSING_TITLE_WARNING,
  validateConfigFilePaths,
  validateFrontmatterFields,
} from '../builder/project-validator.js';
import { loadSiteConfig } from '../config/config-loader.js';
import { ConfigError, translateSystemError } from '../lib/errors.js';
import { parseYamlWithPosition, splitFrontmatter } from '../lib/frontmatter.js';
import { logError, logInfo, logWarning, runWithWarningSink } from '../lib/logger.js';
import { plural } from '../lib/plural.js';

type ValidationError = { file: string; message: string };

type ValidationResult = {
  errors: ValidationError[];
  warnings: ValidationError[];
  count: number;
};

async function validateFrontmatter(cwd: string): Promise<ValidationResult> {
  const entries = await listMarkdownDocuments(cwd);

  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];
  const slugs = new Map<string, string>();
  for (const entry of entries) {
    const absPath = join(cwd, entry);
    let raw: string;
    try {
      raw = await readFile(absPath, 'utf8');
    } catch (err) {
      errors.push({
        file: entry,
        message: `no se pudo leer: ${translateSystemError(err, 'verifica que el nombre del archivo sea correcto')}`,
      });
      continue;
    }

    const { yaml, body } = splitFrontmatter(raw);
    const lineOffset = raw.slice(0, raw.length - body.length).split('\n').length - 1;
    const looseColons = looseColonLines(body, lineOffset);
    if (looseColons.length > 0) {
      warnings.push({ file: entry, message: looseColonsMessage(looseColons) });
    }
    if (!yaml) {
      if (!body.trim()) {
        warnings.push({
          file: entry,
          message: yaml === '' ? 'no tiene contenido después del frontmatter; se omite' : 'documento vacío; se omite',
        });
      } else if (/^---\r?\n/.test(raw)) {
        warnings.push({
          file: entry,
          message: 'frontmatter sin cerrar (falta el bloque "---" final); el contenido se tratará como cuerpo',
        });
      } else {
        warnings.push({ file: entry, message: MISSING_TITLE_WARNING.message });
      }
      continue; // sin frontmatter → válido
    }

    let fmError = false;
    const yamlResult = parseYamlWithPosition(yaml);
    if (yamlResult.error) {
      fmError = true;
      errors.push({
        file: entry,
        message: `frontmatter YAML inválido: ${yamlResult.error}`,
      });
    } else {
      const result = yamlResult.value;
      if (!result || typeof result !== 'object' || Array.isArray(result)) {
        fmError = true;
        errors.push({
          file: entry,
          message: 'frontmatter YAML inválido: debe ser un objeto',
        });
      } else {
        const parsed = result as Record<string, unknown>;
        for (const issue of validateFrontmatterFields(parsed)) {
          if (issue.severity === 'error') {
            fmError = true;
            errors.push({ file: entry, message: issue.message });
          } else {
            warnings.push({ file: entry, message: issue.message });
          }
        }
        const slug = typeof parsed.slug === 'string' ? parsed.slug.trim() : undefined;
        if (slug) {
          const outputKey = `${dirname(entry)}/${slug}`;
          const owner = slugs.get(outputKey);
          if (owner !== undefined) {
            fmError = true;
            errors.push({ file: entry, message: `slug duplicado: "${slug}" ya lo usa ${owner}` });
          } else {
            slugs.set(outputKey, entry);
          }
        }
        if (parsed.title === undefined || parsed.title === '') {
          warnings.push({ file: entry, message: MISSING_TITLE_WARNING.message });
        }
      }
    }
    if (!body.trim() && !fmError) {
      warnings.push({
        file: entry,
        message: 'no tiene contenido después del frontmatter; se omite',
      });
    }
  }
  return { errors, warnings, count: entries.length };
}

export interface ValidationSummary {
  ok: boolean;
  documents: number;
  errors: ValidationError[];
  warnings: ValidationError[];
}

async function collectValidation(cwd: string): Promise<{ summary: ValidationSummary; disabledFiltersCount: number; luaFiltersCount: number }> {
  let disabledFiltersCount = 0;
  let luaFiltersCount = 0;
  const configErrors: ValidationError[] = [];
  const configWarnings: ValidationError[] = [];
  try {
    const config = await loadSiteConfig(cwd);
    disabledFiltersCount = config.disabledFilters?.length ?? 0;
    luaFiltersCount = config.luaFilters?.length ?? 0;
    const strayFilterWarnings: string[] = [];
    await runWithWarningSink(
      (msg) => strayFilterWarnings.push(msg),
      async () => {
        validateDisabledFilters(config.disabledFilters);
      },
    );
    for (const raw of strayFilterWarnings) {
      const message = raw.replace(/^[^\]]*\]\s*/, '');
      configWarnings.push({ file: 'config', message });
    }
    const effectiveDisabledPreamble = resolveEffectiveDisabledPreamble(config.format?.pdf?.disabledPreambleFilters);
    validateDisabledPreambleFilters(effectiveDisabledPreamble);
    for (const issue of validatePreambleDependencies(effectiveDisabledPreamble)) {
      if (issue.severity === 'error') {
        configErrors.push({ file: 'iteraciones.config.yaml', message: issue.message });
      } else {
        configWarnings.push({ file: 'iteraciones.config.yaml', message: issue.message });
      }
    }
    for (const issue of await validateConfigFilePaths(cwd, config)) {
      if (issue.severity === 'error') {
        configErrors.push({ file: 'iteraciones.config.yaml', message: issue.message });
      } else {
        configWarnings.push({ file: 'iteraciones.config.yaml', message: issue.message });
      }
    }
  } catch (err) {
    if (err instanceof ConfigError) {
      configErrors.push({
        file: relative(cwd, err.configPath),
        message: err.message,
      });
    } else {
      configErrors.push({
        file: 'iteraciones.config.yaml',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  const { errors: fmErrors, warnings, count: docCount } = await validateFrontmatter(cwd);
  const errors = [...configErrors, ...fmErrors];
  const allWarnings = [...configWarnings, ...warnings];
  return {
    summary: { ok: errors.length === 0, documents: docCount, errors, warnings: allWarnings },
    disabledFiltersCount,
    luaFiltersCount,
  };
}

export async function validateProject(cwd: string, options: { json?: boolean } = {}): Promise<void> {
  const { summary, disabledFiltersCount, luaFiltersCount } = await collectValidation(cwd);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(summary)}\n`);
    if (!summary.ok) process.exitCode = 1;
    return;
  }
  const { errors, warnings: allWarnings, documents: docCount, ok } = summary;

  if (allWarnings.length > 0) {
    logWarning(`${plural(allWarnings.length, 'advertencia')}:`, 'validate');
    for (const w of allWarnings) {
      logWarning(`${w.file}: ${w.message}`, 'validate');
    }
  }

  if (ok) {
    const detail: string[] = [plural(docCount, 'documento')];
    if (disabledFiltersCount > 0) detail.push(`${plural(disabledFiltersCount, 'filter', 'filters')} desactivados`);
    if (luaFiltersCount > 0) detail.push(`${plural(luaFiltersCount, 'lua-filter', 'lua-filters')}`);
    logInfo(`sin errores — ${detail.join(', ')}.`, 'validate');
    if (docCount === 0) {
      logInfo("si estás empezando, ejecuta 'iteraciones init' para crear el documento inicial", 'validate');
    }
    return;
  }

  logError(`${plural(errors.length, 'error')}:`, 'validate');
  for (const e of errors) {
    logError(`${e.file}: ${e.message}`, 'validate');
  }
  process.exitCode = 1;
}
