import { existsSync } from 'node:fs';
import { relative } from 'node:path';
import { fmString } from '../lib/frontmatter-fields.js';
import { logWarning } from '../lib/logger.js';
import { PACKAGED_APA7_CSL } from './state-bib.js';

/**
 * Composición de metadatos pandoc — ÚNICA fuente (#2175).
 *
 * Tres consumidores armaban `--metadata` con reglas ligeramente distintas y
 * la divergencia produjo bugs reales (EPUB citando con el default de pandoc,
 #2165). Este módulo concentra el escape de valores, la resolución efectiva
 * de campos (el frontmatter del documento manda; la config aporta el default)
 * y la composición de citas. Cada formato añade después solo sus argumentos
 * específicos.
 *
 * Contrato por formato (qué emite cada consumidor):
 *
 * | Campo      | HTML (render)       | PDF (latex-composer)       | EPUB (runner)  | Markdown (runner)     |
 * |------------|---------------------|----------------------------|----------------|-----------------------|
 * | title      | ✔ (vars de página)  | ✔                          | ✔              | — (viene en fm)       |
 * | language   | ✔ clave `lang`      | — (babel-lang de config)   | ✔ `language`   | ✔ `language`          |
 * | creator    | — (viene en fm)     | ✔                          | ✔              | — (viene en fm)       |
 * | date       | — (viene en fm)     | ✔ (pdfDate)                | ✔ (dateIso)    | ✔ (fecha humana)      |
 * | citas      | compileArgs         | --biblatex + --bibliography| compileArgs    | portableMetadataArgs  |
 *
 * Divergencias INTENCIONALES (no unificar):
 * - HTML usa la clave `lang` (variable de su template); el resto, `language`.
 * - PDF NO pasa subtitle por --metadata: el override aplanaría los \n y el
 *   filtro latex/10-titlepages perdería el valor multilinea (frontmatter con
 *   `|`). El filtro lo serializa desde la metadata del documento.
 * - PDF usa biblatex (no citeproc): la bibliografía la compone LaTeX.
 */

/** Escapa un valor para --metadata/--variable: pandoc no admite \n en el flag. */
export function metadataValue(value: string): string {
  return value.replace(/\n/g, ' ');
}

/** Lenguaje efectivo: el frontmatter del documento manda sobre el default. */
export function effectiveLanguage(fm: Record<string, unknown>, fallback: string): string {
  return fmString(fm.language, fallback);
}

/** `--metadata=title` (PDF y EPUB; HTML resuelve el título desde sus vars). */
export function titleArg(title: string): string {
  return `--metadata=title:${metadataValue(title)}`;
}

/** `--metadata=language` o `--metadata=lang` (la clave la fija el template). */
export function languageArg(language: string, key: 'language' | 'lang' = 'language'): string {
  return `--metadata=${key}:${language}`;
}

/** `--metadata=creator` por cada autor (orden preservado). */
export function creatorArgs(creator: string[]): string[] {
  return creator.map((c) => `--metadata=creator:${metadataValue(c)}`);
}

/**
 * `--metadata=date` si hay fecha (incluida la cadena vacía: el PDF la usa
 * para SUPRIMIR la fecha del frontmatter en la portada cuando show-date es
 * false — un override vacío es distinto de ausente).
 */
export function dateArg(date: string | undefined): string[] {
  return date !== undefined ? [`--metadata=date:${metadataValue(date)}`] : [];
}

/**
 * Citas para COMPILACIÓN (HTML y EPUB): citeproc + bibliografía efectiva +
 * CSL efectivo (configurado o APA-7 empaquetado — paridad garantizada aquí,
 * no por convención en cada consumidor).
 */
export function citationCompileArgs(bibliography: string | undefined, csl: string | undefined): string[] {
  if (!bibliography) return [];
  return ['--citeproc', '--bibliography', bibliography, '--csl', csl ?? PACKAGED_APA7_CSL];
}

/**
 * Citas para el export MARKDOWN: metadatos con rutas relativas al proyecto
 * (el export es portable: mover el proyecto no rompe las citas).
 */
export function citationPortableMetadataArgs(bibliography: string | undefined, csl: string | undefined, cwd: string): string[] {
  const args: string[] = [];
  if (bibliography) args.push(`--metadata=bibliography:${relative(cwd, bibliography)}`);
  if (csl) {
    if (existsSync(csl)) args.push(`--metadata=csl:${relative(cwd, csl)}`);
    else logWarning(`archivo CSL no encontrado: "${csl}"`, 'export');
  }
  return args;
}
