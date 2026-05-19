import { access, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { resolveTemplatePath } from '../builder/classifier/resolve-template.js';
import { EXPORTABLE_TYPES } from '../builder/export/types.js';
import { VALID_TYPES } from '../builder/pipeline/type-graph.js';
import { resolveThemePaths } from '../builder/theme-resolver.js';
import { VALID_REGIONS } from '../builder/types.js';
import { loadSiteConfig } from '../config/config-loader.js';
import { IGNORED_DIRS } from '../constants.js';
import { ConfigError } from '../errors.js';
import { FRONTMATTER_RE, parseFrontmatter } from '../loader/frontmatter.js';

type ValidationError = { file: string; message: string };

// theme se pasa desde runValidate para evitar que loadSiteConfig se llame dos veces
// (una en validateConfig + otra aquí), lo que duplicaría los warnings de stderr.
type ValidationResult = { errors: ValidationError[]; warnings: ValidationError[] };

async function validateFrontmatter(cwd: string, theme: string | undefined): Promise<ValidationResult> {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  // Resolver el tema una sola vez antes del loop para evitar emitir el warning
  // "tema desconocido" una vez por cada archivo tipado del proyecto.
  const themePaths = resolveThemePaths(theme);

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

    // block: true sin region: el build omite el bloque con un aviso; reportar como advertencia.
    if (fm.block && !fm.region) {
      warnings.push({ file: entry, message: 'block: true pero region: no está definido. El bloque no se insertará en ninguna región del layout' });
    }

    // items: en colecciones deben apuntar a archivos existentes; el builder siempre
    // resuelve items por relativePath con extensión .md, por lo que se normaliza aquí.
    const effectiveType = fm.type && VALID_TYPES.has(fm.type as Parameters<typeof VALID_TYPES.has>[0]) ? fm.type : 'file';
    if (effectiveType === 'collection' && fm.items.length > 0) {
      for (const item of fm.items) {
        const normalizedItem = item.endsWith('.md') ? item : `${item}.md`;
        const itemPath = join(cwd, normalizedItem);
        const itemExists = await access(itemPath)
          .then(() => true)
          .catch(() => false);
        if (!itemExists) {
          errors.push({ file: entry, message: `items: "${item}" no existe en el proyecto` });
        }
      }
    }

    // Validar que el template resuelto automáticamente existe.
    // El builder nunca lee frontmatter.template; usa siempre resolveTemplatePath(type, theme, cwd).
    if (fm.type && VALID_TYPES.has(fm.type as Parameters<typeof VALID_TYPES.has>[0])) {
      const resolvedTemplate = resolveTemplatePath(fm.type as Parameters<typeof VALID_TYPES.has>[0], theme, cwd, themePaths);
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

    // Validar rutas de archivos editoriales (editorial.cover, .bibliography, .csl).
    // Si estos archivos no existen, el build falla con un error críptico de LaTeX/Pandoc.
    if (EXPORTABLE_TYPES.has(effectiveType as Parameters<typeof EXPORTABLE_TYPES.has>[0])) {
      const rawEditorial =
        typeof parsed['editorial'] === 'object' && parsed['editorial'] !== null ? (parsed['editorial'] as Record<string, unknown>) : null;

      if (rawEditorial) {
        const editorialPaths: Array<[string, string]> = [
          ['editorial.cover', typeof rawEditorial['cover'] === 'string' ? rawEditorial['cover'] : ''],
          ['editorial.bibliography', typeof rawEditorial['bibliography'] === 'string' ? rawEditorial['bibliography'] : ''],
          ['editorial.csl', typeof rawEditorial['csl'] === 'string' ? rawEditorial['csl'] : ''],
        ];
        for (const [fieldName, fieldValue] of editorialPaths) {
          if (!fieldValue) continue;
          const absFilePath = join(cwd, fieldValue);
          const fileExists = await access(absFilePath)
            .then(() => true)
            .catch(() => false);
          if (!fileExists) {
            errors.push({ file: entry, message: `${fieldName}: "${fieldValue}" no existe en el proyecto` });
          }
        }
      }
    }
  }
  return { errors, warnings };
}

/**
 * Valida la configuración del proyecto y el frontmatter de los ficheros Markdown.
 * Incluye validación semántica: tipos, regiones, items de colecciones y templates.
 * No ejecuta la compilación completa.
 */
export async function runValidate(cwd: string): Promise<void> {
  // Cargar la configuración una sola vez para evitar que loadSiteConfig emita
  // advertencias duplicadas (p. ej. "accent desconocido") si se invoca en paralelo
  // desde validateConfig y validateFrontmatter por separado.
  let theme: string | undefined;
  const configErrors: ValidationError[] = [];
  try {
    const config = await loadSiteConfig(cwd);
    theme = config.theme;
  } catch (err) {
    if (err instanceof ConfigError) {
      configErrors.push({ file: relative(cwd, err.configPath), message: err.message });
    } else {
      configErrors.push({ file: '_iteraciones.yaml', message: err instanceof Error ? err.message : String(err) });
    }
  }
  const { errors: fmErrors, warnings } = await validateFrontmatter(cwd, theme);
  const errors = [...configErrors, ...fmErrors];

  if (warnings.length > 0) {
    process.stderr.write(`validate: ${warnings.length} advertencia(s):\n`);
    for (const w of warnings) {
      process.stderr.write(`  ⚠ ${w.file}: ${w.message}\n`);
    }
  }

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
