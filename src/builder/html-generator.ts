import { mkdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { logWarning } from '../lib/logger.js';
import { mapWithConcurrency } from '../lib/run.js';
import type { BuildOptions } from './orchestrator.js';
import { renderHtmlPageFromAst } from './render.js';
import { discoverBibFiles, readAstFromCache, resolveBibOptions } from './state.js';
import type { BuildContext, BuildDocument } from './types.js';

/**
 * Genera páginas HTML completas para cada documento usando el template de pandoc.
 * Cada documento se procesa en paralelo (lee AST del disco, escribe su HTML).
 */
export async function generateHtmlPages(
  ctx: BuildContext,
  pipelineDocs: BuildDocument[],
  formatsDir: string,
  options: BuildOptions,
  onProgress?: (relativePath: string) => void,
): Promise<void> {
  const siteConfig = ctx.siteConfig;
  const htmlConfig = siteConfig.format?.html;
  const hasCss = !options.noCss && ctx.cssPath;
  const { bibOptions } = resolveBibOptions(ctx.cwd);
  // Cada documento es independiente (lee AST del disco, escribe su HTML): paralelizar
  await mapWithConcurrency(pipelineDocs, ctx.concurrency, async (doc) => {
    const slug = doc.slug ?? basename(doc.relativePath, '.md');
    const dir = dirname(doc.relativePath);
    const dst = join(formatsDir, 'html', dir, `${slug}.html`);
    const ast = await readAstFromCache(ctx.cwd, doc);
    if (!ast) {
      logWarning(`sin AST en caché para ${doc.relativePath}; se omite la página HTML`, 'html');
      return;
    }
    let logoInline: string | undefined;
    try {
      const logoRel = htmlConfig?.logo?.trim();
      const logoSrc = logoRel ? join(ctx.cwd, logoRel) : join(import.meta.dir, '../../src/lib/resources/logo.svg');
      logoInline = await Bun.file(logoSrc).text();
    } catch (err) {
      logWarning(`no se pudo leer el logo para ${doc.relativePath}: ${String(err)}`, 'html');
    }
    try {
      const html = await renderHtmlPageFromAst(
        ast,
        doc,
        ctx.cwd,
        {
          title: doc.frontmatter.title || slug,
          siteTitle: htmlConfig?.title ?? 'iteraciones',
          tagline: htmlConfig?.tagline ?? 'escribir, compartir, re-existir',
          lang: siteConfig.lang ?? 'es',
          baseUrl: htmlConfig?.baseUrl,
          theme: htmlConfig?.theme,
          accent: htmlConfig?.accent,
          css: hasCss ? 'css/styles.css' : undefined,
          authorMeta: doc.frontmatter.author.join(', '),
          logoInline,
        },
        ctx.siteConfig,
        bibOptions,
      );
      await mkdir(dirname(dst), { recursive: true });
      await Bun.write(dst, html);
      onProgress?.(doc.relativePath);
    } catch (err) {
      logWarning(`error al generar HTML para ${doc.relativePath}: ${String(err)}`, 'html');
    }
  });
}
