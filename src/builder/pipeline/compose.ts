import { readFile } from 'node:fs/promises';
import type { CacheManager } from '../../cache/cache-manager.js';
import { hash } from '../../cache/hasher.js';
import { mapWithConcurrency } from '../../output/concurrency.js';
import type { RenderFileReport } from '../../output/progress.js';
import type { PluginRegistry } from '../../plugin/registry.js';
import type { AstNode } from '../../template/ast.js';
import { tokenize } from '../../template/lexer.js';
import { parse } from '../../template/parser.js';
import type { TemplateContext } from '../../template/render/context.js';
import { renderAst } from '../../template/render/renderer.js';
import { docHtmlPath } from '../slug.js';
import { resolveEffectivePaths } from '../theme-resolver.js';
import { buildTocHtml } from '../toc.js';
import { type BuildContext, type BuildDocument, VALID_REGIONS } from '../types.js';

export interface ComposeCache {
  manager: CacheManager;
  cliVersion: string;
  /** Hash de los paths de plugins activos. Invalida la caché si cambia el conjunto de plugins. */
  pluginFingerprint?: string;
  /** Cuando true, omite la poda de entradas obsoletas al terminar.
   * Usar en builds incrementales donde solo se procesa un subset de documentos:
   * podar con un subset eliminaría entradas válidas de los docs no procesados. */
  skipPrune?: boolean;
}

/** Contadores acumulativos de la fase de compose; se mutan en lugar de retornar un nuevo objeto. */
export interface ComposeStats {
  total: number;
  cacheHits: number;
}

async function readAndParseTemplate(path: string): Promise<{ ast: AstNode[]; contentHash: string }> {
  const content = await readFile(path, 'utf8');
  return { ast: parse(tokenize(content)), contentHash: hash(content) };
}

export async function composeDocuments(
  docs: BuildDocument[],
  ctx: BuildContext,
  cache?: ComposeCache,
  registry?: PluginRegistry,
  stats?: ComposeStats,
  /** Mapa de relativePath → sourceHash para todos los documentos activos.
   * Permite detectar cambios en items de colecciones sin serializar su contenido. */
  itemHashMap?: ReadonlyMap<string, string>,
  /** Callback invocado por cada archivo compuesto (para reporte de progreso). */
  onFileProcessed?: (report: RenderFileReport) => void,
): Promise<BuildDocument[]> {
  const { layoutPath, pandocTemplatePath } = resolveEffectivePaths(ctx.siteConfig.theme, ctx.cwd);
  const layoutTemplate = await readFile(layoutPath, 'utf8');
  const pandocTemplate = await readFile(pandocTemplatePath, 'utf8');

  if (!layoutTemplate.includes('$body$')) {
    throw new Error(`El layout en "${layoutPath}" no contiene el marcador $body$`);
  }
  if (!pandocTemplate.includes('$body$')) {
    throw new Error(`El pandoc template en "${pandocTemplatePath}" no contiene el marcador $body$`);
  }

  // Pre-parsear layout y pandoc template una sola vez.
  const layoutAst = parse(tokenize(layoutTemplate));
  const pandocAst = parse(tokenize(pandocTemplate));
  // Hashes del contenido de los templates compartidos para detectar cambios sin bump de versión.
  const layoutHash = hash(layoutTemplate);
  const pandocHash = hash(pandocTemplate);

  // Pre-parsear los templates por tipo (únicos) para no releer el mismo archivo por cada doc.
  const uniqueTemplatePaths = [...new Set(docs.map((d) => d.templatePath).filter((p): p is string => !!p))];
  const templateDataMap = new Map(await Promise.all(uniqueTemplatePaths.map(async (p) => [p, await readAndParseTemplate(p)] as const)));

  // Hash del contexto de sitio: cubre siteConfig + cssPath + menuHref/menuTitle.
  // ctx.cssPath puede diferir del siteConfig si --no-tailwind está activo.
  // Se calcula una sola vez fuera del loop.
  const siteCtxHash = cache ? hash(JSON.stringify(ctx.siteConfig), ctx.cssPath) : '';

  const activeComposeKeys = cache ? new Set<string>() : null;

  const result = await mapWithConcurrency(docs, ctx.concurrency ?? 4, async (doc) => {
    const tStart = performance.now();
    if (!doc.templateContext) {
      throw new Error(`composeDocuments: templateContext no definido en "${doc.relativePath}"`);
    }
    if (doc.htmlFragment === undefined) {
      throw new Error(`composeDocuments: htmlFragment no definido en "${doc.relativePath}"`);
    }

    const typeTemplateHash = doc.templatePath ? (templateDataMap.get(doc.templatePath)?.contentHash ?? '') : '';
    const key = cache
      ? hash(
          doc.htmlFragment,
          doc.sourceHash,
          doc.relativePath,
          ...(doc.frontmatter.items ?? []).map((itemPath) => itemHashMap?.get(itemPath) ?? itemPath),
          siteCtxHash,
          cache.cliVersion,
          layoutHash,
          pandocHash,
          typeTemplateHash,
          cache.pluginFingerprint ?? '',
        )
      : '';

    if (cache) {
      activeComposeKeys?.add(key);
      const cached = await cache.manager.read('compose', key);
      if (cached !== undefined) {
        if (stats) {
          stats.total++;
          stats.cacheHits++;
        }
        onFileProcessed?.({ relativePath: doc.relativePath, durationMs: performance.now() - tStart, cacheHit: true, phase: 'compose' });
        return { ...doc, outputHtml: cached };
      }
    }

    // beforeCompose: permite al plugin modificar el templateContext antes de renderizar.
    // La clave de caché se calcula sobre el contexto original; las modificaciones del
    // plugin se persisten en el resultado cacheado (válido para plugins deterministas).
    let effectiveTemplateContext: TemplateContext = doc.templateContext;
    if (registry) {
      const beforeCtx = await registry.runBeforeCompose({
        outputRelativePath: docHtmlPath(doc),
        templateContext: doc.templateContext as Readonly<Record<string, unknown>>,
      });
      effectiveTemplateContext = beforeCtx.templateContext as TemplateContext;
    }

    // Inyectar índice de contenidos (TOC) si está habilitado en la configuración.
    // Prioridad: export.layout.html.toc > site.html.toc
    const exportHtmlLayout = ctx.siteConfig.export?.layout?.html;
    const showToc = exportHtmlLayout?.toc ?? ctx.siteConfig.html.toc;
    const tocDepth = exportHtmlLayout?.tocDepth ?? ctx.siteConfig.html.tocDepth;
    if (showToc && doc.htmlFragment) {
      const tocHtml = buildTocHtml(doc.htmlFragment, tocDepth);
      if (tocHtml) {
        effectiveTemplateContext = { ...effectiveTemplateContext, 'table-of-contents': tocHtml };
      }
    }

    // Paso 1: renderizar el template específico del tipo de documento (templates/{type}.html).
    // El template usa $body$ para el htmlFragment y puede añadir estructura adicional (encabezados, listas).
    const typeAst = doc.templatePath ? templateDataMap.get(doc.templatePath)?.ast : undefined;
    const innerHtml = typeAst ? renderAst(typeAst, effectiveTemplateContext) : ((effectiveTemplateContext.body as string) ?? '');

    // Paso 2: envolver el HTML del tipo en el layout del sitio (header de navegación, main, footer).
    const layoutHtml = renderAst(layoutAst, { ...effectiveTemplateContext, body: innerHtml });

    // Paso 3: envolver el layout en el documento HTML completo (doctype, head, link CSS).
    let outputHtml = renderAst(pandocAst, { ...effectiveTemplateContext, body: layoutHtml });

    // afterCompose: permite al plugin postprocesar el HTML final de la página.
    if (registry) {
      const afterCtx = await registry.runAfterCompose({ outputRelativePath: docHtmlPath(doc), html: outputHtml });
      outputHtml = afterCtx.html;
    }

    if (cache) {
      await cache.manager.write('compose', key, outputHtml);
    }

    if (stats) stats.total++;
    onFileProcessed?.({ relativePath: doc.relativePath, durationMs: performance.now() - tStart, cacheHit: false, phase: 'compose' });
    return { ...doc, outputHtml };
  });

  // Podar entradas obsoletas del scope 'compose' al final, una vez que todas las claves
  // activas han sido registradas. Se hace aquí y no en el orchestrator porque la fórmula
  // de la clave depende de los hashes de templates que solo se conocen dentro de esta función.
  // En builds incrementales (subset de docs) se omite la poda para no eliminar entradas
  // válidas de documentos que no se procesaron en este batch.
  if (cache && activeComposeKeys && !cache.skipPrune) {
    await cache.manager.prune('compose', activeComposeKeys);
  }

  return result;
}

/**
 * Renderiza los documentos de tipo bloque (`kind === 'block'`) usando solo su
 * template de tipo (sin layout ni pandoc wrapper), agrupa el HTML resultante
 * por región y devuelve un mapa { región → HTML concatenado }.
 *
 * El resultado se inyecta en el siteCtx compartido para que los region slots
 * del layout (`$content-before$`, `$footer-left$`, etc.) se rellenen en todas
 * las páginas del sitio.
 *
 * Precondición: cada doc debe tener `templateContext` y `htmlFragment` ya
 * asignados, y `frontmatter.region` debe ser un Region válido.
 */
export async function renderBlocksToRegions(blockDocs: BuildDocument[]): Promise<Record<string, string>> {
  if (blockDocs.length === 0) return {};

  const uniqueTemplatePaths = [...new Set(blockDocs.map((d) => d.templatePath).filter((p): p is string => !!p))];
  const templateAstMap = new Map<string, AstNode[]>(
    await Promise.all(
      uniqueTemplatePaths.map(async (p) => {
        const { ast } = await readAndParseTemplate(p);
        return [p, ast] as const;
      }),
    ),
  );

  const regionMap = new Map<string, string[]>();

  for (const doc of blockDocs) {
    const region = doc.frontmatter.region;
    if (!region) {
      process.stderr.write(`[iteraciones] bloque "${doc.relativePath}" no tiene frontmatter.region — se omite.\n`);
      continue;
    }
    if (!VALID_REGIONS.has(region as Parameters<typeof VALID_REGIONS.has>[0])) {
      process.stderr.write(
        `[iteraciones] bloque "${doc.relativePath}" tiene región inválida "${region}". Valores permitidos: ${[...VALID_REGIONS].join(', ')}.\n`,
      );
      continue;
    }
    if (!doc.templateContext || doc.htmlFragment === undefined) continue;

    const typeAst = doc.templatePath ? templateAstMap.get(doc.templatePath) : undefined;
    const innerHtml = typeAst ? renderAst(typeAst, doc.templateContext) : ((doc.templateContext.body as string) ?? '');

    const parts = regionMap.get(region) ?? [];
    parts.push(innerHtml);
    regionMap.set(region, parts);
  }

  return Object.fromEntries([...regionMap.entries()].map(([region, parts]) => [region, parts.join('\n')]));
}
