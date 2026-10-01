import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { BuildError, translateSystemError } from '../lib/errors.js';
import { splitFrontmatter } from '../lib/frontmatter.js';
import type { BuildMetadata } from './build-planner.js';
import { parseAuthors } from './discover-frontmatter.js';
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

/**
 * #2463 — un documento sin cuerpo **no** es algo que se saltea en silencio: es
 * un error de build con mensaje accionable. Antes el warning dejaba `files[]`
 * de una collection apuntando a un `.md` que jamás se escribía, y el build
 * salía con 0.
 *
 * Las dos excepciones componen su cuerpo de otros archivos —`collection` con
 * sus `files[]` e `intervention`—, así que un body vacío es legítimo en ellas.
 * `validate` aplica exactamente el mismo criterio (los dos caminos coinciden).
 */
export async function readMarkdownOrWarn(doc: BuildDocument): Promise<string> {
  let content: string;
  try {
    content = await Bun.file(doc.filePath).text();
  } catch (err) {
    throw new BuildError(`no se pudo leer "${doc.filePath}": ${translateSystemError(err, 'verifica que el nombre del archivo sea correcto')}`);
  }
  const { yaml, body } = splitFrontmatter(content);
  if (!body.trim() && doc.frontmatter.type !== 'collection' && doc.frontmatter.type !== 'intervention') {
    throw new BuildError(
      yaml !== undefined
        ? `"${doc.filePath}" no tiene contenido después del frontmatter; agrega un body para proceder con el build`
        : `"${doc.filePath}" está vacío; agrega un body para proceder con el build`,
    );
  }
  return content;
}

/** Los cuatro formatos con enlace en la página; el orden fija el de salida. */
const FORMAT_LINK_META = {
  pdf: { name: 'PDF', description: 'Documento final para lectura e impresión' },
  epub: { name: 'EPUB', description: 'Edición adaptable para lectura digital' },
  latex: { name: 'LaTeX', description: 'Archivo fuente para composición tipográfica' },
  markdown: { name: 'Markdown', description: 'Texto fuente reutilizable y portable' },
} as const;

type FormatLinkKey = keyof typeof FORMAT_LINK_META;

export function formatLinksFor(
  plan: BuildMetadata,
  dir: string,
  outSlug: string,
): { href: string; key: FormatLinkKey; name: string; description: string }[] {
  return (Object.keys(FORMAT_LINK_META) as FormatLinkKey[])
    .filter((key) => plan.activeFormats[key])
    .map((key) => ({
      href: relativeHref(dir, `${outSlug}${primaryOutputExtension(key)}`),
      key,
      ...FORMAT_LINK_META[key],
    }));
}

export function parseFileFrontmatter(content: string): {
  title: string;
  creator: string[];
  subtitle: string | undefined;
  type: string | undefined;
  lineLength: number | undefined;
  pages: number | undefined;
  body: string;
} {
  const { yaml, body } = splitFrontmatter(content);
  if (!yaml) return { title: '', creator: [], subtitle: undefined, type: undefined, lineLength: undefined, pages: undefined, body };
  try {
    const parsed = Bun.YAML.parse(yaml) as Record<string, unknown>;
    return {
      title: typeof parsed.title === 'string' ? parsed.title : '',
      creator: parseAuthors(parsed.creator),
      subtitle: typeof parsed.subtitle === 'string' ? parsed.subtitle : undefined,
      type: typeof parsed.type === 'string' ? parsed.type : undefined,
      lineLength: typeof parsed.lineLength === 'number' ? parsed.lineLength : undefined,
      pages: typeof parsed.pages === 'number' ? parsed.pages : undefined,
      body,
    };
  } catch {
    return { title: '', creator: [], subtitle: undefined, type: undefined, lineLength: undefined, pages: undefined, body };
  }
}
