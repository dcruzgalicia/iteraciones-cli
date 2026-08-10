/**
 * Reproducibilidad manual del build (experimento): para cada documento y
 * formato generado, escribe en .iteraciones/repro/ todo lo necesario para
 * ejecutar el mismo comando pandoc a mano (o copiarlo a la terminal) y
 * obtener exactamente el archivo final del build.
 *
 * El input es SIEMPRE el markdown original del proyecto (con su frontmatter,
 * que pandoc lee como metadata): el CLI solo complementa con --metadata los
 * valores que no vienen del frontmatter.
 *
 * Estructura:
 *   .iteraciones/repro/
 *   ├── postprocess-html.py         post-procesamiento de referencias (HTML)
 *   ├── html/<dir>/<slug>.sh        script: pandoc → raw + bun → final
 *   ├── html/<dir>/<slug>.raw.html  salida intermedia del pandoc puro
 *   ├── html/<dir>/<slug>/          variables grandes (logo-inline, formats)
 *   ├── latex/<dir>/<slug>.sh       script: pandoc → .tex en dist/
 *   ├── pdf/<dir>/<slug>.sh         script: pandoc → .tex + latexmk → .pdf
 *   ├── epub/<dir>/<slug>.sh        script: pandoc → .epub
 *   └── markdown/<dir>/<slug>.sh    script: pandoc → .md
 */
import { chmodSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { htmlSlugFor } from './discover.js';

/** Recurso del paquete: post-procesamiento de referencias (mismo código que render.ts). */
const POSTPROCESS_HTML_TS = join(import.meta.dir, '../lib/resources/repro/postprocess-html.ts');

/** Documento mínimo para la reproducción (BuildDocument o ExportDocument). */
type ReproDoc = { filePath: string; relativePath: string; slug?: string };

/** Contexto de reproducción del build (rutas base y formatos activos). */
export interface ReproCtx {
  /** .iteraciones/repro */
  reproDir: string;
  /** dist/files (destino de los archivos finales) */
  distDir: string;
  /** .iteraciones/tmp/pdf (área de trabajo del PDF: .tex sin latexOn y auxiliares) */
  pdfWorkDir: string;
  latexOn: boolean;
  pdfOn: boolean;
}

/** Cita un valor para el shell (comillas simples + escape de apóstrofes). */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function writeFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, content);
}

function slugOf(doc: ReproDoc): string {
  return doc.slug ?? basename(doc.relativePath, '.md');
}

/** Escribe un script ejecutable con el comando de reproducción. */
async function writeScript(path: string, lines: string[]): Promise<void> {
  await writeFile(path, `${lines.join('\n')}\n`);
  chmodSync(path, 0o755);
}

/**
 * Líneas del comando de reproducción: pandoc recibe el markdown original
 * completo (el frontmatter fluye como metadata del documento).
 */
function pandocCommand(to: string, args: string[], doc: ReproDoc, output: string): string[] {
  const lines = [`pandoc --from markdown+auto_identifiers --to ${to} \\`];
  for (const arg of args) lines.push(`  ${arg} \\`);
  lines.push(`  ${shellQuote(doc.filePath)} \\`);
  lines.push(`  -o ${shellQuote(output)}`);
  return lines;
}

/**
 * Script HTML: pandoc puro a un .raw.html + post-procesamiento de referencias
 * (el único paso que no hace pandoc). Las variables grandes (logo-inline,
 * formats) viajan como archivos y el script las lee con "$(cat ...)".
 */
export async function writeHtmlReproScript(repro: ReproCtx, doc: ReproDoc, extraArgs: string[]): Promise<void> {
  const slug = slugOf(doc);
  const htmlSlug = htmlSlugFor(doc.relativePath, slug);
  const dir = dirname(doc.relativePath);
  const rawPath = join(repro.reproDir, 'html', dir, `${slug}.raw.html`);
  const finalPath = join(repro.distDir, dir, `${htmlSlug}.html`);
  const auxDir = join(repro.reproDir, 'html', dir, slug);

  const scriptArgs: string[] = [];
  for (const arg of extraArgs) {
    if (arg.startsWith('--variable=logo-inline:')) {
      const svg = arg.slice('--variable=logo-inline:'.length);
      await writeFile(join(auxDir, 'logo-inline.svg'), svg);
      scriptArgs.push(`--variable=logo-inline:"$(cat ${shellQuote(join(auxDir, 'logo-inline.svg'))})"`);
    } else if (arg.startsWith('--variable=formats:')) {
      const block = arg.slice('--variable=formats:'.length);
      await writeFile(join(auxDir, 'formats.html'), block);
      scriptArgs.push(`--variable=formats:"$(cat ${shellQuote(join(auxDir, 'formats.html'))})"`);
    } else {
      scriptArgs.push(shellQuote(arg));
    }
  }

  await writeScript(join(repro.reproDir, 'html', dir, `${slug}.sh`), [
    '#!/bin/sh',
    `# Reproducción manual del HTML de "${doc.relativePath}" (generado por iteraciones-cli)`,
    '# Uso: sh este-archivo.sh — regenera el archivo final en dist (idéntico al build)',
    'set -e',
    ...pandocCommand('html5', scriptArgs, doc, rawPath),
    '# Post-procesamiento mínimo (referencias): extraer del body e insertar en el marcador',
    `bun ${shellQuote(POSTPROCESS_HTML_TS)} ${shellQuote(rawPath)} ${shellQuote(finalPath)}`,
  ]);
}

/**
 * Scripts LaTeX y PDF: el .tex final sale de una sola invocación pandoc
 * (template efectivo + filtros); el PDF compila ese .tex con latexmk y lo
 * mueve a dist (mismos argumentos que el pipeline).
 */
export async function writeLatexReproScripts(repro: ReproCtx, doc: ReproDoc, extraArgs: string[]): Promise<void> {
  const slug = slugOf(doc);
  const dir = dirname(doc.relativePath);
  // El .tex final vive en dist/ (si latexOn); el PDF compila en el área de trabajo
  const texDistPath = join(repro.distDir, dir, `${slug}.tex`);
  const workDir = join(repro.pdfWorkDir, dir);

  if (repro.latexOn) {
    await writeScript(join(repro.reproDir, 'latex', dir, `${slug}.sh`), [
      '#!/bin/sh',
      `# Reproducción manual del .tex de "${doc.relativePath}" (generado por iteraciones-cli)`,
      '# Uso: sh este-archivo.sh — regenera el .tex final en dist (idéntico al build)',
      'set -e',
      ...pandocCommand('latex', extraArgs.map(shellQuote), doc, texDistPath),
    ]);
  }

  if (repro.pdfOn) {
    await writeScript(join(repro.reproDir, 'pdf', dir, `${slug}.sh`), [
      '#!/bin/sh',
      `# Reproducción manual del PDF de "${doc.relativePath}" (generado por iteraciones-cli)`,
      '# Uso: sh este-archivo.sh — regenera el PDF final en dist (idéntico al build)',
      'set -e',
      ...pandocCommand('latex', extraArgs.map(shellQuote), doc, join(workDir, `${slug}.tex`)),
      `export PAR_GLOBAL_TEMP=${shellQuote(join(repro.reproDir, 'biber'))}`,
      `latexmk -pdf -interaction=nonstopmode -outdir=${shellQuote(workDir)} -jobname=${shellQuote(slug)} ${shellQuote(join(workDir, `${slug}.tex`))}`,
      `mv ${shellQuote(join(workDir, `${slug}.pdf`))} ${shellQuote(join(repro.distDir, dir, `${slug}.pdf`))}`,
    ]);
  }
}

/** Script EPUB: una invocación pandoc directa al archivo final. */
export async function writeEpubReproScript(repro: ReproCtx, doc: ReproDoc, extraArgs: string[]): Promise<void> {
  const slug = slugOf(doc);
  const dir = dirname(doc.relativePath);
  await writeScript(join(repro.reproDir, 'epub', dir, `${slug}.sh`), [
    '#!/bin/sh',
    `# Reproducción manual del EPUB de "${doc.relativePath}" (generado por iteraciones-cli)`,
    '# Uso: sh este-archivo.sh — regenera el EPUB final en dist (idéntico al build)',
    'set -e',
    ...pandocCommand('epub3', extraArgs.map(shellQuote), doc, join(repro.distDir, dir, `${slug}.epub`)),
  ]);
}

/** Script Markdown: pandoc puro sobre el original (el frontmatter fluye y el writer emite el YAML). */
export async function writeMarkdownReproScript(repro: ReproCtx, doc: ReproDoc, extraArgs: string[]): Promise<void> {
  const slug = slugOf(doc);
  const dir = dirname(doc.relativePath);
  await writeScript(join(repro.reproDir, 'markdown', dir, `${slug}.sh`), [
    '#!/bin/sh',
    `# Reproducción manual del Markdown de "${doc.relativePath}" (generado por iteraciones-cli)`,
    '# Uso: sh este-archivo.sh — regenera el .md final en dist (idéntico al build)',
    'set -e',
    ...pandocCommand('markdown', extraArgs.map(shellQuote), doc, join(repro.distDir, dir, `${slug}.md`)),
  ]);
}
