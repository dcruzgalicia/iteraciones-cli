import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { BuildError, translateSystemError } from '../lib/errors.js';
import { splitFrontmatter } from '../lib/frontmatter.js';
import { logWarning } from '../lib/logger.js';
import type { BuildMetadata } from './build-planner.js';
import { primaryOutputExtension } from './output-layout.js';
import type { BuildDocument } from './types.js';

/**
 * Helpers de I/O y formato de salida del pipeline (#2176): lectura del
 * markdown original, escritura con directorio padre, hrefs relativos y los
 * enlaces de formatos de la página HTML. Sin orquestación ni conocimiento de
 * pools: los consumidores son pipeline-formats y pipeline-setup.
 */

/**
 * Ruta relativa desde el directorio de un documento (en dist/files/) hasta
 * un archivo en la raíz de salida. Permite abrir el HTML con file:// sin
 * servidor: los enlaces son relativos al documento, no absolutos.
 * Ej: dir='.' → './css/styles.css'; dir='posts' → './../css/styles.css'.
 */
export function relativeHref(dir: string, file: string): string {
  const depth = dir === '.' ? 0 : dir.split('/').length;
  return `./${'../'.repeat(depth)}${file}`;
}

/** Escribe un archivo creando su directorio padre. */
export async function writeOutput(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, content);
}

/**
 * Escribe el archivo solo si el contenido cambió respecto al existente.
 * Evita tocar el disco cuando el contenido es idéntico (consistente con la
 * filosofía de caché del resto del pipeline: nada se escribe sin necesidad).
 */
export async function writeIfChanged(path: string, content: string): Promise<void> {
  if (await Bun.file(path).exists()) {
    try {
      const existing = await Bun.file(path).text();
      if (existing === content) return;
    } catch {
      // Archivo ilegible: se reescribe
    }
  }
  await writeOutput(path, content);
}

/** Lee el markdown del documento y valida el cuerpo; null = omitido (aviso emitido). */
export async function readMarkdownOrWarn(doc: BuildDocument): Promise<string | null> {
  // El markdown original completo (el frontmatter fluye a pandoc como metadata):
  // se lee una sola vez y se reutiliza en todas las conversiones del documento.
  let content: string;
  try {
    content = await Bun.file(doc.filePath).text();
  } catch (err) {
    // Con hint de ENOENT: al leer el documento del usuario el motivo común es
    // un nombre mal escrito o un archivo que nunca existió.
    throw new BuildError(`no se pudo leer "${doc.filePath}": ${translateSystemError(err, 'verifica que el nombre del archivo sea correcto')}`);
  }
  // Validación: el documento debe tener cuerpo después del frontmatter. Un
  // documento vacío (o con frontmatter sin cuerpo) se omite con un warning:
  // un accidente de 0 bytes no debe cancelar el build completo.
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

/** Enlaces a los formatos generados que aparecen en la página HTML. */
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
