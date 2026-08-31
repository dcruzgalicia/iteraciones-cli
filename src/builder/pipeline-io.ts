import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { BuildError, translateSystemError } from '../lib/errors.js';
import { splitFrontmatter } from '../lib/frontmatter.js';
import { logWarning } from '../lib/logger.js';
import type { BuildMetadata } from './build-planner.js';
import { primaryOutputExtension } from './output-layout.js';
import type { BuildDocument } from './types.js';

export function relativeHref(dir: string, file: string): string {
  const depth = dir === '.' ? 0 : dir.split('/').length;
  return `./${'../'.repeat(depth)}${file}`;
}

export async function writeOutput(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, content);
}

export async function writeIfChanged(path: string, content: string): Promise<void> {
  if (await Bun.file(path).exists()) {
    try {
      const existing = await Bun.file(path).text();
      if (existing === content) return;
    } catch {}
  }
  await writeOutput(path, content);
}

export async function readMarkdownOrWarn(doc: BuildDocument): Promise<string | null> {
  let content: string;
  try {
    content = await Bun.file(doc.filePath).text();
  } catch (err) {
    throw new BuildError(`no se pudo leer "${doc.filePath}": ${translateSystemError(err, 'verifica que el nombre del archivo sea correcto')}`);
  }
  const { yaml, body } = splitFrontmatter(content);
  if (!body.trim()) {
    logWarning(
      yaml !== undefined
        ? `"${doc.filePath}" no tiene contenido después del frontmatter; se omite del build`
        : `"${doc.filePath}" está vacío; se omite del build`,
      'build',
    );
    return null;
  }
  return content;
}

export function formatLinksFor(
  plan: BuildMetadata,
  dir: string,
  outSlug: string,
): { href: string; key: 'pdf' | 'epub' | 'latex' | 'markdown'; name: string; description: string }[] {
  const formats = [];
  if (plan.activeFormats.pdf) {
    formats.push({
      href: relativeHref(dir, `${outSlug}${primaryOutputExtension('pdf')}`),
      key: 'pdf' as const,
      name: 'PDF',
      description: 'Documento final para lectura e impresión',
    });
  }
  if (plan.activeFormats.epub) {
    formats.push({
      href: relativeHref(dir, `${outSlug}${primaryOutputExtension('epub')}`),
      key: 'epub' as const,
      name: 'EPUB',
      description: 'Edición adaptable para lectura digital',
    });
  }
  if (plan.activeFormats.latex) {
    formats.push({
      href: relativeHref(dir, `${outSlug}${primaryOutputExtension('latex')}`),
      key: 'latex' as const,
      name: 'LaTeX',
      description: 'Archivo fuente para composición tipográfica',
    });
  }
  if (plan.activeFormats.markdown) {
    formats.push({
      href: relativeHref(dir, `${outSlug}${primaryOutputExtension('markdown')}`),
      key: 'markdown' as const,
      name: 'Markdown',
      description: 'Texto fuente reutilizable y portable',
    });
  }
  return formats;
}
