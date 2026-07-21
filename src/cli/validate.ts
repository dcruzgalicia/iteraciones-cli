import { readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { resolveTemplatePath } from '../builder/classifier/resolve-template.js';
import { EXPORTABLE_TYPES } from '../builder/export/types.js';
import { VALID_TYPES } from '../builder/pipeline/type-graph.js';
import { resolveThemePaths } from '../builder/theme-resolver.js';
import { VALID_REGIONS } from '../builder/types.js';
import { loadSiteConfig } from '../config/config-loader.js';
import { IGNORED_DIRS } from '../constants.js';
import { ConfigError } from '../errors.js';
import type { CollectionItem } from '../loader/frontmatter.js';
import { FRONTMATTER_RE, parseFrontmatter } from '../loader/frontmatter.js';
import { checkLatexEngine } from './doctor/system-checks.js';

type ValidationError = { file: string; message: string };

// theme se pasa desde runValidate para evitar que loadSiteConfig se llame dos veces
// (una en validateConfig + otra aquí), lo que duplicaría los warnings de stderr.
type ValidationResult = {
  errors: ValidationError[];
  warnings: ValidationError[];
};

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
      errors.push({
        file: entry,
        message: `no se pudo leer: ${err instanceof Error ? err.message : String(err)}`,
      });
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
        errors.push({
          file: entry,
          message: 'frontmatter YAML inválido: debe ser un objeto',
        });
        continue;
      }
      parsed = result as Record<string, unknown>;
      fm = parseFrontmatter(raw).frontmatter;
    } catch (err) {
      errors.push({
        file: entry,
        message: `frontmatter YAML inválido: ${err instanceof Error ? err.message : String(err)}`,
      });
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
      warnings.push({
        file: entry,
        message: 'block: true pero region: no está definido. El bloque no se insertará en ninguna región del layout',
      });
    }

    // items: en colecciones deben apuntar a archivos existentes; el builder siempre
    // resuelve items por relativePath con extensión .md, por lo que se normaliza aquí.
    // Soporta el nuevo schema unificado (strings, {file}, {title,items}).
    async function validateItem(item: CollectionItem): Promise<void> {
      if (typeof item === 'string') {
        const normalized = item.endsWith('.md') ? item : `${item}.md`;
        const itemPath = join(cwd, normalized);
        const exists = await stat(itemPath)
          .then((s) => s.isFile())
          .catch(() => false);
        if (!exists)
          errors.push({
            file: entry,
            message: `items: "${item}" no existe en el proyecto`,
          });
      } else if ('file' in item && typeof item.file === 'string') {
        // { file, part? }
        const file = item.file.endsWith('.md') ? item.file : `${item.file}.md`;
        const itemPath = join(cwd, file);
        const exists = await stat(itemPath)
          .then((s) => s.isFile())
          .catch(() => false);
        if (!exists)
          errors.push({
            file: entry,
            message: `items: "${item.file}" no existe en el proyecto`,
          });
      } else if ('title' in item && 'items' in item) {
        // { title, items } — part container
        for (const sub of item.items) {
          await validateItem(sub);
        }
      }
    }

    const effectiveType = fm.type && VALID_TYPES.has(fm.type as Parameters<typeof VALID_TYPES.has>[0]) ? fm.type : 'file';
    if (effectiveType === 'collection' && fm.items.length > 0) {
      for (const item of fm.items) {
        await validateItem(item);
      }
    }

    // Validar que el template resuelto automáticamente existe.
    // El builder nunca lee frontmatter.template; usa siempre resolveTemplatePath(type, theme, cwd).
    if (fm.type && VALID_TYPES.has(fm.type as Parameters<typeof VALID_TYPES.has>[0])) {
      const resolvedTemplate = resolveTemplatePath(fm.type as Parameters<typeof VALID_TYPES.has>[0], theme, cwd, themePaths);
      const templateExists = await stat(resolvedTemplate)
        .then((s) => s.isFile())
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
          const fileExists = await stat(absFilePath)
            .then((s) => s.isFile())
            .catch(() => false);
          if (!fileExists) {
            errors.push({
              file: entry,
              message: `${fieldName}: "${fieldValue}" no existe en el proyecto`,
            });
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
  let theme: string | undefined;
  let hasPdf = false;
  const configErrors: ValidationError[] = [];
  try {
    const config = await loadSiteConfig(cwd);
    theme = config.format?.html?.theme;
    hasPdf = !!config.format?.pdf;
  } catch (err) {
    if (err instanceof ConfigError) {
      configErrors.push({
        file: relative(cwd, err.configPath),
        message: err.message,
      });
    } else {
      configErrors.push({
        file: '_iteraciones.yaml',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Si format.pdf esta configurado, verificar que el motor LaTeX este disponible.
  if (hasPdf) {
    const latexResult = await checkLatexEngine('pdflatex');
    if (!latexResult.ok) {
      configErrors.push({
        file: '_iteraciones.yaml',
        message: 'format.pdf requiere pdflatex pero no esta disponible — ' + (latexResult.detail ?? ''),
      });
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
