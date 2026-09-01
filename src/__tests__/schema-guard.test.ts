import { describe, expect, it } from 'bun:test';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { SCHEMA_SOURCE_FILES } from '../builder/state-hash.js';

/**
 * SCHEMA_SOURCE_FILES contiene los módulos cuya lógica afecta a los bytes de
 * una salida cacheada. Si un módulo que afecta la salida no está en la lista,
 * cambiarlo NO invalida la caché y las salidas quedan stale en silencio.
 *
 * Este test verifica la cobertura: scan de módulos que composan args de pandoc
 * o template, comparación contra SCHEMA_SOURCE_FILES + allowlist. Cada módulo
 * de la allowlist debe tener justificación.
 *
 * Si añades un módulo nuevo que afecta salidas: añádelo a SCHEMA_SOURCE_FILES.
 * Si añades un módulo que NO afecta salidas (utility): añádelo a la allowlist
 * con justificación en el comentario.
 */

// Patrones que indican que un módulo afecta bytes de salidas cacheadas:
// composición de args de pandoc, templates, XMP, ensamblado de export.
const HEURISTIC_PATTERNS = [
  /execPandoc/, // invoca pandoc con args
  /metadataArgs|metadataValue/, // compone args de metadata para pandoc
  /citationCompileArgs|citationPortableMetadataArgs/, // compone args de citas
  /composeHtmlTemplate|composeLatexTemplate/, // composición de templates
  /injectXmpMetadata/, // inyección XMP en .tex
  /assembleExportDocument/, // ensamblado de ExportDocument
] as const;

// Módulos que pasan los heurísticos pero NO afectan bytes de salida:
// utilities cuya lógica no determina los bytes de una salida específica.
// Cada entrada requiere justificación.
const ALLOWLIST: Record<string, string> = {
  // writeOutput: utility de escritura genérica; los bytes dependen de QUÉ lo llama
  'pipeline-io.ts': 'utility genérica: writeOutput, readMarkdownOrWarn',
  // state-hash: calcula hashes pero no produce bytes de salida
  'state-hash.ts': 'utility de hashing: no escribe outputs cacheados',
  // state-serialize: persistencia de state.json, no genera outputs
  'state-serialize.ts': 'persistencia de caché interna, no genera outputs',
  // state-bib: descubrimiento y hash de bibliografía, no produce outputs
  'state-bib.ts': 'descubrimiento y hash de bib, no produce outputs',
  // filter-resolver: resolución de filtros, no afecta bytes directamente
  'filter-resolver.ts': 'resolución de filters por nombre, no composición',
  // preamble-loader: carga preamble filters, no composición
  'preamble-loader.ts': 'carga y resolución de preamble filters',
  // gitignore: exclusión de paths, no afecta bytes de salida
  'gitignore.ts': 'exclusión de paths ocultos, no produce outputs',
  // image-processor: preproceso de imágenes, no composición de args
  'image-processor.ts': 'preproceso de imágenes, no composición de args',
  // slug-resolver: resolución de slugs, no afecta bytes
  'slug-resolver.ts': 'resolución de slugs a URLs, no bytes de salida',
  // discover.ts: detección de cambios, no composición
  'discover.ts': 'detección de cambios y slugs, no composición',
  // build-planner: planificación, no composición
  'build-planner.ts': 'planificación de trabajo, no composición',
  // project-validator: validación, no composición
  'project-validator.ts': 'validación de frontmatter/config, no composición',
  // cleanup: limpieza de dist, no composición
  'cleanup.ts': 'limpieza de archivos residuales, no composición',
  // reporter: reporter nulo para headless
  'reporter.ts': 'reporter nulo para uso headless',
  // types: tipos, sin lógica
  'types.ts': 'tipos TypeScript, sin lógica',
  // config modules: no afectan bytes directamente
  'config-schema.ts': 'esquema Zod de config, no composición',
  'config-loader.ts': 'carga de config, no composición',
  'site-config.ts': 'defaults de config, no composición',
  // state.ts: barrel, no composición
  'state.ts': 'barrel que re-exporta, no composición',
  // pdfx-check: validación, no composición de outputs
  'pdfx-check.ts': 'validación PDF/X, no composición de outputs',
  // pdf-pool: pool de compilación PDF, orquestación no composición
  'pdf-pool.ts': 'pool consumidor de compilación PDF',
  // pipeline-setup: setup y contextos, orquestación
  'pipeline-setup.ts': 'setup compartido y contextos, no composición directa de bytes',
  // pipeline.ts: orquestación de pools
  'pipeline.ts': 'orquestador puro de pools, no composición directa',
  // coverImage.ts: generación de portadas (pdftoppm)
  'coverImage.ts': 'generación de portadas con pdftoppm, output derivado no cacheado',
  // export/types.ts: tipos, sin lógica
  'export/types.ts': 'tipos de export, sin lógica',
  // frontmatter-fields.ts: resolución de campos con precedencia, utility
  'frontmatter-fields.ts': 'resolución de campos de frontmatter con precedencia, utility',
  // pandoc-runner.ts: invocación universal de pandoc, utility
  'pandoc-runner.ts': 'utility de invocación de pandoc, no compone args',
};

describe('SCHEMA_SOURCE_FILES cobertura', () => {
  const schemaSet = new Set<string>(SCHEMA_SOURCE_FILES);
  const allowlistSet = new Set(Object.keys(ALLOWLIST));

  it('todos los archivos listados existen', async () => {
    const schemaBase = resolve(import.meta.dir, '../builder');
    for (const file of SCHEMA_SOURCE_FILES) {
      const abs = join(schemaBase, file);
      expect(await Bun.file(abs).exists()).toBe(true);
    }
  });

  it('módulos con heurístico de composición están cubiertos o en la allowlist', async () => {
    const builderDir = resolve(import.meta.dir, '../../src/builder');
    const libDir = resolve(import.meta.dir, '../../src/lib');
    const srcFiles: { name: string; dir: string }[] = [
      ...(await readdir(builderDir).then((files) =>
        files.filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts')).map((f) => ({ name: f, dir: builderDir })),
      )),
      ...(await readdir(libDir).then((files) =>
        files.filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts')).map((f) => ({ name: f, dir: libDir })),
      )),
    ];

    const uncovered: string[] = [];

    for (const { name: filename, dir } of srcFiles) {
      const abs = join(dir, filename);
      let content: string;
      try {
        content = await readFile(abs, 'utf-8');
      } catch {
        continue;
      }
      const matchesHeuristic = HEURISTIC_PATTERNS.some((pattern) => pattern.test(content));
      if (!matchesHeuristic) continue;

      const inSchema = [...schemaSet].some((s) => s === `./${filename}` || s.endsWith(`/${filename}`));
      const inAllowlist = allowlistSet.has(filename);

      if (!inSchema && !inAllowlist) {
        uncovered.push(filename);
      }
    }

    if (uncovered.length > 0) {
      throw new Error(`SCHEMA_SOURCE_FILES incompleta (entries: ${SCHEMA_SOURCE_FILES.length}): ${uncovered.join(', ')}`);
    }
    expect(true).toBe(true); //uite verde si no hay uncovered
  });
});
