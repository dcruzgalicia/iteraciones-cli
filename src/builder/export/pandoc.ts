import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { PdfFormatConfig } from '../../config/site-config.js';
import { PandocError } from '../../lib/errors.js';
import type { ExportDocument } from './types.js';

/**
 * Construye el bloque YAML de metadatos que Pandoc inyectará en el documento.
 * Solo usada para exportación a Markdown.
 */
function buildYamlHeader(doc: ExportDocument): string {
  const { metadata } = doc;
  const lines: string[] = ['---'];

  lines.push(`title: ${yamlString(metadata.title)}`);

  if (metadata.author.length > 0) {
    if (metadata.author.length === 1) {
      lines.push(`author: ${yamlString(metadata.author[0] ?? '')}`);
    } else {
      lines.push('author:');
      for (const a of metadata.author) {
        lines.push(`  - ${yamlString(a)}`);
      }
    }
  }

  if (metadata.date) lines.push(`date: ${yamlString(metadata.date)}`);
  lines.push(`lang: ${metadata.lang}`);
  lines.push(`documentclass: ${metadata.documentclass}`);
  if (metadata.toc) lines.push('toc: true');
  if (metadata.tocDepth !== undefined && metadata.tocDepth > 0) {
    lines.push(`toc-depth: ${metadata.tocDepth}`);
  }

  // Metadatos editoriales opcionales
  if (metadata.isbn) lines.push(`isbn: ${yamlString(metadata.isbn)}`);
  if (metadata.publisher) lines.push(`publisher: ${yamlString(metadata.publisher)}`);
  if (metadata.description) lines.push(`description: ${yamlString(metadata.description)}`);
  if (metadata.rights) lines.push(`rights: ${yamlString(metadata.rights)}`);
  if (metadata.cover) lines.push(`cover-image: ${yamlString(metadata.cover)}`);
  if (metadata.bibliography) {
    lines.push(`bibliography: ${yamlString(metadata.bibliography)}`);
  }
  if (metadata.csl) {
    if (existsSync(metadata.csl)) {
      lines.push(`csl: ${yamlString(metadata.csl)}`);
    } else {
      process.stderr.write(`\r\x1b[K⚠ archivo CSL no encontrado: "${metadata.csl}"\n`);
    }
  }

  if (metadata.dictum && metadata.dictum.length > 0) {
    lines.push('dictum:');
    for (const entry of metadata.dictum) {
      if (entry.author) {
        lines.push(`  - text: ${yamlString(entry.text)}`);
        lines.push(`    author: ${yamlString(entry.author)}`);
      } else {
        lines.push(`  - text: ${yamlString(entry.text)}`);
      }
    }
  }
  if (metadata.abstract) lines.push(`abstract: ${yamlString(metadata.abstract)}`);
  if (metadata.keywords && metadata.keywords.length > 0) {
    lines.push('keywords:');
    for (const kw of metadata.keywords) {
      lines.push(`  - ${yamlString(kw)}`);
    }
  }

  lines.push('---', '');
  return lines.join('\n');
}

function yamlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

/**
 * Convierte contenido HTML a EPUB3 usando pandoc.
 */
export async function convertToEpub(htmlBody: string, outputPath: string, doc?: ExportDocument): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });

  const args = ['pandoc', '--from', 'html', '--to', 'epub3', '--output', outputPath];

  if (doc?.metadata.cover) {
    args.push('--epub-cover-image', doc.metadata.cover);
  }

  if (doc?.metadata.bibliography) {
    args.push('--citeproc');
  }

  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn(args, { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
  } catch (err) {
    throw new PandocError(`pandoc no está disponible en PATH: ${String(err)}`, doc?.filePath ?? '', '');
  }

  if (proc.stdin == null || typeof proc.stdin === 'number') {
    throw new PandocError('No se pudo escribir stdin de pandoc', doc?.filePath ?? '', '');
  }

  proc.stdin.write(htmlBody);
  proc.stdin.end();

  const [stderr, exitCode] = await Promise.all([new Response(proc.stderr as ReadableStream<Uint8Array>).text(), proc.exited]);

  if (exitCode !== 0) {
    throw new PandocError(`pandoc falló al generar EPUB`, doc?.filePath ?? '', stderr);
  }
}

/**
 * Exporta un documento a Markdown via pandoc (latex → markdown).
 */
export async function convertToMarkdown(doc: ExportDocument, outputPath: string): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });
  const args = ['pandoc', '--from', 'latex', '--to', 'markdown'];
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn(args, { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
  } catch (err) {
    throw new PandocError(`pandoc no está disponible en PATH: ${String(err)}`, doc.filePath, '');
  }
  if (proc.stdin == null || typeof proc.stdin === 'number') {
    throw new PandocError('No se pudo escribir stdin de pandoc', doc.filePath, '');
  }
  if (proc.stdout == null || typeof proc.stdout === 'number') {
    throw new PandocError('No se pudo leer stdout de pandoc', doc.filePath, '');
  }
  if (proc.stderr == null || typeof proc.stderr === 'number') {
    throw new PandocError('No se pudo leer stderr de pandoc', doc.filePath, '');
  }
  proc.stdin.write(doc.body);
  proc.stdin.end();
  const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  if (exitCode !== 0) {
    throw new PandocError(`pandoc falló al convertir a markdown ${doc.filePath}`, doc.filePath, stderr);
  }
  const yamlHeader = buildYamlHeader(doc);
  await Bun.write(outputPath, yamlHeader + stdout);
}

/**
 * Convierte un ExportDocument a PDF compilando el .tex con latexmk.
 */
export async function convertToPdf(
  doc: ExportDocument,
  outputPath: string,
  cwd?: string,
  pdfFormat?: PdfFormatConfig,
  biberCacheDir?: string,
): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });

  if (!cwd) {
    throw new PandocError('convertToPdf: cwd es requerido para localizar el .tex', doc.filePath, '');
  }

  const slug = doc.slug ?? basename(doc.relativePath, '.md');
  const texRelDir = dirname(doc.relativePath);
  const pdfDir = join(cwd, '.iteraciones', 'formats', 'pdf', texRelDir);
  const fullTexPath = join(pdfDir, `${slug}.tex`);

  if (!(await Bun.file(fullTexPath).exists())) {
    throw new PandocError(`convertToPdf: no se encontro ${fullTexPath}`, doc.filePath, '');
  }

  const biberCache = biberCacheDir ?? join(cwd, '.iteraciones', 'biber', texRelDir, slug);
  await mkdir(biberCache, { recursive: true });
  const proc = Bun.spawn(['latexmk', '-pdf', '-interaction=nonstopmode', `-outdir=${pdfDir}`, `-jobname=${slug}`, fullTexPath], {
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, PAR_GLOBAL_TEMP: biberCache },
  });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);

  if (exitCode !== 0) {
    const log = stdout + '\n' + stderr;
    const m = log.match(/^! .*$/m);
    throw new PandocError(`latexmk falló al generar PDF para ${doc.filePath}: ${m ? m[0] : 'exit ' + exitCode}`, doc.filePath, stderr);
  }
}
