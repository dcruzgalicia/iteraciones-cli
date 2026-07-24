import { mkdir, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { loadSiteConfig } from '../config/config-loader.js';
import { type PipelinePhase, ProgressTracker } from '../output/progress.js';

import type { TemplateContext } from '../template/render/context.js';
import { buildAssets } from './assets.js';
import { createAuthorDocumentIndex } from './context/authors.js';
import { buildSiteContext } from './context/site.js';
import { injectCoverIntoListItems, injectDownloadLinks, injectDownloadLinksIntoListItems, runExportDocuments } from './export/runner.js';
import { EXPORTABLE_TYPES, type ExportResult } from './export/types.js';
import { escapeHtml } from './html.js';
import { buildLatexPreamble } from './latex-preamble.js';
import { classifyDocuments } from './pipeline/classify.js';
import { composeDocuments, renderBlocksToRegions } from './pipeline/compose.js';
import { computeAffectedDocs } from './pipeline/dependency-resolver.js';
import { buildDocsFromIndex, discover } from './pipeline/discover.js';
import { renderDocuments, renderLatex } from './pipeline/render.js';
import { runContextPhaseWithTypeGraph } from './pipeline/runner.js';
import { TYPE_STAGE_MAP } from './pipeline/type-graph.js';
import { writeDocuments } from './pipeline/write.js';
import { computeSlug, docHref } from './slug.js';
import type { AuthorDocumentIndex, BuildContext, BuildDocument, DocumentType } from './types.js';

export interface BuildOptions {
  outputDir?: string;
  cssPath?: string;
  concurrency?: number;
  /** Omite lectura y escritura de la caché; siempre hace build completo. */
  noCache?: boolean;
  /** Omite la generación de CSS con Tailwind; copia fonts y logo igualmente. */
  noTailwind?: boolean;
  /** Omite la exportación PDF/EPUB aunque esté configurada en _iteraciones.yaml. */
  noExport?: boolean;
  /** Muestra los documentos que se procesarían sin generar salida. */
  dryRun?: boolean;
  /** Imprime información adicional de progreso durante el build. */
  verbose?: boolean;
  /** Rutas relativas de archivos modificados; limita el pipeline a docs afectados. */
  changedPaths?: Set<string>;
}

// ---------------------------------------------------------------------------
// Interfaces internas de resultado entre funciones del pipeline
// ---------------------------------------------------------------------------

interface PrimaryRenderResult {
  renderedFileDocs: BuildDocument[];
  renderedAuthorDocs: BuildDocument[];
  renderedEventDocs: BuildDocument[];
  authorDocumentIndex: AuthorDocumentIndex;
}

interface BlocksPrestepResult {
  finalSiteCtx: TemplateContext;
  renderedBlockDocs: BuildDocument[];
}

// ---------------------------------------------------------------------------
// Helpers puros (sin efectos secundarios)
// ---------------------------------------------------------------------------

/** Excluye del pool todos los documentos marcados con `draft: true`. */
function excludeDrafts(docs: BuildDocument[]): BuildDocument[] {
  return docs.filter((doc) => !doc.frontmatter.draft);
}

/**
 * Calcula el prefijo relativo para navegar desde `relativePath` hasta la raíz del sitio.
 * Ejemplos: 'index.md' -> './',  'personas/sofia.md' -> '../',  'a/b/c.md' -> '../../'
 */
function computeRootPrefix(relativePath: string): string {
  const depth = relativePath.split('/').length - 1;
  return depth === 0 ? './' : '../'.repeat(depth);
}

/**
 * Recorre recursivamente un TemplateContext y convierte toda cadena que empiece con '/'
 * en una ruta relativa usando `prefix`. Permite que el sitio funcione con file://.
 * Los strings HTML (region slots de bloques) se procesan con regex para relativizar
 * atributos href y src que contengan rutas root-relative embebidas en el marcado.
 *
 * `depth` protege contra objetos circulares emitidos por plugins mal escritos.
 */
function makeRelativeContext(value: unknown, prefix: string, depth = 0): unknown {
  if (depth > 20) throw new Error('makeRelativeContext: profundidad máxima excedida (posible objeto circular en el contexto de un plugin)');
  if (typeof value === 'string') {
    if (value.startsWith('/')) return prefix + value.slice(1);
    if (value.includes('href="/') || value.includes('src="/'))
      return value
        .replace(/href="(\/[^"]+)"/g, (_, p) => `href="${prefix}${p.slice(1)}"`)
        .replace(/src="(\/[^"]+)"/g, (_, p) => `src="${prefix}${p.slice(1)}"`);
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => makeRelativeContext(item, prefix, depth + 1));
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, makeRelativeContext(v, prefix, depth + 1)]));
  return value;
}

// ---------------------------------------------------------------------------
// Funciones del pipeline (Fase 1a)
// ---------------------------------------------------------------------------

/**
 * Prepara el entorno de build: carga config, crea el BuildContext.
 */
async function setupBuildEnvironment(cwd: string, options: BuildOptions): Promise<BuildContext> {
  const siteConfig = await loadSiteConfig(cwd);

  const defaultOutputDir = join(cwd, 'dist', 'files');
  const ctx: BuildContext = {
    siteConfig,
    cwd,
    outputDir: options.outputDir ?? defaultOutputDir,
    cssPath: options.cssPath ?? '',
    concurrency: options.concurrency ?? 4,
  };

  if (options.noCache) {
    await rm(ctx.outputDir, { recursive: true, force: true });
    await rm(join(cwd, '.iteraciones'), { recursive: true, force: true });
    if (siteConfig.format?.pdf?.generate === true || (siteConfig.format?.html?.thumbnails && siteConfig.format?.pdf !== undefined)) {
      await clearBiberCache();
    }
  }

  return ctx;
}

/**
 * Descubre, clasifica y filtra borradores. Retorna el pool de documentos activos.
 */
async function runDiscovery(
  cwd: string,
  ctx: BuildContext,
  noCache?: boolean,
): Promise<{ docs: BuildDocument[]; changedPaths: Set<string>; deletedEntries: Map<string, { title: string; author: string[] }> }> {
  const result = await discover(cwd, { noCache });
  const sourceDocs = buildDocsFromIndex(result.relativePaths, result.discoveryIndex, cwd);
  const classified = classifyDocuments(sourceDocs, ctx.siteConfig.format?.html?.theme, ctx.cwd);
  const allDocs = excludeDrafts(classified);
  const draftCount = classified.length - allDocs.length;
  if (draftCount > 0) {
    process.stderr.write(`[iteraciones] ${draftCount} borrador${draftCount > 1 ? 'es' : ''} excluido${draftCount > 1 ? 's' : ''} (draft:true)\n`);
  }
  return { docs: allDocs, changedPaths: result.changedPaths, deletedEntries: result.deletedEntries };
}

/**
 * Lee el contenido del logo SVG (el del proyecto o el por defecto del paquete)
 * para inyectarlo inline en las templates con currentColor heredado del tema.
 * Devuelve undefined si el logo no es SVG o no se pudo leer.
 */
async function readLogoSvgContent(ctx: BuildContext): Promise<string | undefined> {
  const logo = ctx.siteConfig.logo?.trim();
  let svgPath: string;
  const isSvg = logo ? logo.endsWith('.svg') : true; // El logo por defecto es SVG

  if (logo && isSvg) {
    svgPath = join(ctx.cwd, logo);
  } else if (!logo) {
    const pkgRoot = join(import.meta.dir, '../..');
    svgPath = join(pkgRoot, 'themes', 'default', 'logo.svg');
  } else {
    return undefined; // Logo no-SVG, no se puede hacer inline
  }

  try {
    const content = await Bun.file(svgPath).text();
    if (content.trimStart().startsWith('<svg') || content.trimStart().startsWith('<?xml')) {
      return content;
    }
    return undefined;
  } catch {
    if (logo) {
      process.stderr.write(`\r\x1b[K⚠ no se pudo leer el SVG del logo en "${svgPath}"\n`);
    }
    return undefined;
  }
}

/**
 * Construye el siteCtx base e inyecta menuHref/menuTitle si existe un documento
 * primario de tipo 'menu'. El contexto resultante se comparte por todas las páginas.
 */
function buildEnrichedSiteContext(ctx: BuildContext, allDocs: BuildDocument[], logoSvg?: string): TemplateContext {
  const siteCtx = buildSiteContext(ctx.siteConfig, ctx.cssPath);
  const primaryMenuDoc = allDocs.find((doc) => doc.type === 'menu' && doc.kind !== 'block');
  const base = primaryMenuDoc
    ? {
        ...siteCtx,
        menuHref: docHref(primaryMenuDoc),
        menuTitle: escapeHtml(primaryMenuDoc.frontmatter.title || 'Menú'),
      }
    : siteCtx;

  if (logoSvg) {
    return { ...base, 'site-logo-svg': logoSvg };
  }
  return base;
}

/**
 * Renderiza (Pandoc) los tipos primarios: file, author, event.
 * Construye el authorDocumentIndex a partir de los autores renderizados.
 * Estos datos son prerequisito para el pre-paso de bloques.
 */
/**
 * Resuelve rutas globales de bibliography y csl desde la configuración del sitio.
 */
function resolveGlobalExportPaths(ctx: BuildContext): {
  globalBibliography?: string;
  globalCsl?: string;
} {
  const cwd = ctx.cwd;
  let globalBibliography: string | undefined;
  try {
    const glob = new Bun.Glob('**/*.bib');
    for (const file of glob.scanSync({ cwd, absolute: true })) {
      const rel = file.replace(cwd, '').replace(/^\/+/, '');
      if (rel.startsWith('node_modules/') || rel.startsWith('.iteraciones/') || rel.startsWith('dist/') || rel.startsWith('.git/')) continue;
      globalBibliography = file;
      break;
    }
  } catch {}
  return { globalBibliography, globalCsl: undefined };
}

async function runPrimaryRender(allDocs: BuildDocument[], ctx: BuildContext, cwd?: string): Promise<PrimaryRenderResult> {
  const { globalBibliography, globalCsl } = resolveGlobalExportPaths(ctx);
  const fileDocs = allDocs.filter((doc) => doc.type === 'file' && doc.kind !== 'block');
  const renderedFileDocs = await renderDocuments(fileDocs, ctx.concurrency ?? 4, undefined, cwd, globalBibliography, globalCsl);

  const authorDocs = allDocs.filter((doc) => doc.type === 'author' && doc.kind !== 'block');
  const renderedAuthorDocs = await renderDocuments(authorDocs, ctx.concurrency ?? 4, undefined, cwd, globalBibliography, globalCsl);
  // Índice de autores por título normalizado (lowercase). Se construye aquí para que
  // esté disponible antes del pre-paso de bloques y del paso de contexto de páginas.
  const authorDocumentIndex = createAuthorDocumentIndex(renderedAuthorDocs);

  const eventDocs = allDocs.filter((doc) => doc.type === 'event' && doc.kind !== 'block');
  const renderedEventDocs = await renderDocuments(eventDocs, ctx.concurrency ?? 4, undefined, cwd, globalBibliography, globalCsl);

  return {
    renderedFileDocs,
    renderedAuthorDocs,
    renderedEventDocs,
    authorDocumentIndex,
  };
}

/**
 * Pre-paso de bloques: renderiza todos los docs con kind === 'block', construye
 * sus contextos con datos reales, aplica templates para obtener innerHtml y
 * agrupa por región. El resultado se inyecta en finalSiteCtx para que los
 * region slots del layout se rellenen en todas las páginas.
 * Los bloques NO generan su propio archivo HTML de salida.
 *
 * Usa el type-graph para construir el contexto de cada bloque sin un switch hardcoded.
 * Si un tipo no tiene spec registrada en TYPE_STAGES, falla explícitamente.
 */
async function runBlocksPrestep(
  allDocs: BuildDocument[],
  ctx: BuildContext,
  enrichedSiteCtx: TemplateContext,
  primaryRendered: ReadonlyMap<DocumentType, BuildDocument[]>,
  authorDocumentIndex: AuthorDocumentIndex,
  cwd?: string,
): Promise<BlocksPrestepResult> {
  const { globalBibliography, globalCsl } = resolveGlobalExportPaths(ctx);
  const allBlockDocs = allDocs.filter((doc) => doc.kind === 'block');
  const renderedBlockDocs = await renderDocuments(allBlockDocs, ctx.concurrency ?? 4, undefined, cwd, globalBibliography, globalCsl);
  const contextBlockDocs = renderedBlockDocs.map((doc) => {
    const spec = doc.type ? TYPE_STAGE_MAP.get(doc.type) : undefined;
    if (!spec) {
      throw new Error(
        `runBlocksPrestep: tipo de bloque sin spec en el type-graph: "${doc.type ?? 'undefined'}". ¿Falta añadir una TypeStageSpec en type-graph.ts?`,
      );
    }
    return {
      ...doc,
      templateContext: spec.buildBlockContext(doc, enrichedSiteCtx, primaryRendered, authorDocumentIndex),
    };
  });
  const regionBlocks = await renderBlocksToRegions(contextBlockDocs);
  return {
    finalSiteCtx: { ...enrichedSiteCtx, ...regionBlocks },
    renderedBlockDocs,
  };
}

/**
 * Escribe los archivos .tex final e intermedio para cada documento.
 */
async function writeTexFiles(allContextDocs: BuildDocument[], ctx: BuildContext, log: (msg: string) => void): Promise<void> {
  const pdfCfg = ctx.siteConfig.format?.pdf;
  const latexGen = ctx.siteConfig.format?.latex?.generate === true;
  const needsPdfForThumbnails = ctx.siteConfig.format?.html?.thumbnails && pdfCfg !== undefined;
  const needsTex = pdfCfg?.generate === true || needsPdfForThumbnails || latexGen;
  if (!needsTex) return;

  let texWritten = 0;
  let texCopied = 0;
  for (const doc of allContextDocs) {
    if (!doc.processedBody) continue;
    const texSlug = doc.slug ?? basename(doc.relativePath, '.md');
    const outDir = join(ctx.outputDir, dirname(doc.relativePath));
    const texPath = join(outDir, `${texSlug}.tex`);

    const preamble = await buildLatexPreamble(
      ctx.siteConfig.format?.pdf,
      {
        title: doc.frontmatter?.title as string | undefined,
        author: doc.frontmatter?.author as string[] | undefined,
        date: doc.frontmatter?.date as string | undefined,
        filePath: doc.filePath,
        cwd: ctx.cwd,
      },
      ctx.siteConfig.disabledPreambleTranspilers,
    );

    const pdfDir = join(ctx.cwd, '.iteraciones', 'formats', 'pdf', dirname(doc.relativePath), texSlug);
    await mkdir(pdfDir, { recursive: true });

    // Body post-transpilers — para fase 2 (Markdown → LaTeX)
    const phase1LatexDir = join(ctx.cwd, '.iteraciones', 'tex', dirname(doc.relativePath));
    await mkdir(phase1LatexDir, { recursive: true });
    await Bun.write(join(phase1LatexDir, `${texSlug}.tex`), doc.processedBody);

    // .tex completo — para PDF (única copia, junto a sus auxiliares)
    // Siempre se escribe si se necesita PDF, aunque latex.generate sea false
    const bodyClean = doc.processedBody.replace(/\n+$/, '');
    const fullTex = [...preamble, '', bodyClean, '', '\\end{document}'].join('\n');
    const fullTexPath = join(pdfDir, `${texSlug}.tex`);
    await Bun.write(fullTexPath, fullTex);
    texWritten++;

    // .tex final en dist/ — solo si latex.generate: true
    if (latexGen) {
      await mkdir(outDir, { recursive: true });
      await Bun.write(texPath, fullTex);
      texCopied++;
    }
  }
  if (texWritten > 0) {
    log(`Escritos ${texWritten} archivos .tex en formats/pdf/${texCopied > 0 ? `, copiados ${texCopied} a dist/` : ''}`);
  }
}

/**
 * Fase final: compone HTML, plugins, manifiesto y poda de caché.
 * Debe ejecutarse al final, despues de exportar todos los formatos.
 */
async function runFinalization(allContextDocs: BuildDocument[], ctx: BuildContext, log: (msg: string) => void): Promise<void> {
  const generateHtml = ctx.siteConfig.format?.html?.generate !== false;

  if (generateHtml) {
    const relativizedDocs = allContextDocs.map((doc) => ({
      ...doc,
      templateContext: makeRelativeContext(doc.templateContext, computeRootPrefix(doc.relativePath)) as TemplateContext,
    }));
    const composedDocs = await composeDocuments(relativizedDocs, ctx);
    const docs = await writeDocuments(composedDocs, ctx);
    log(`Escritos ${docs.length} archivos en ${ctx.outputDir}`);
  } else {
    log('HTML desactivado: omitiendo generación de HTML');
  }
}

// ---------------------------------------------------------------------------
// Punto de entrada público
// ---------------------------------------------------------------------------

export async function build(cwd: string, options: BuildOptions = {}): Promise<void> {
  // --dry-run: solo descubrir y clasificar; mostrar resumen sin generar salida.
  if (options.dryRun) {
    const dryConfig = await loadSiteConfig(cwd);
    const { relativePaths, discoveryIndex } = await discover(cwd, { noCache: true });
    const sourceDocs = buildDocsFromIndex(relativePaths, discoveryIndex, cwd);
    const classified = classifyDocuments(sourceDocs, dryConfig.format?.html?.theme, cwd);
    const allDocs = excludeDrafts(classified);
    const draftCount = classified.length - allDocs.length;
    const counts = new Map<string, number>();
    for (const doc of allDocs) {
      const type = doc.type ?? 'unknown';
      counts.set(type, (counts.get(type) ?? 0) + 1);
    }
    process.stdout.write(`[dry-run] Se procesarían ${allDocs.length} documentos`);
    if (draftCount > 0) process.stdout.write(` (${draftCount} omitido${draftCount > 1 ? 'es' : ''} por draft:true)`);
    process.stdout.write(':\n');
    for (const [type, count] of [...counts.entries()].sort()) {
      process.stdout.write(`  ${type.padEnd(12)}: ${count}\n`);
    }
    return;
  }

  const progress = new ProgressTracker({ verbose: options.verbose ?? false });
  const log = (msg: string) => progress.log(msg);

  const ctx = await setupBuildEnvironment(cwd, options);
  try {
    // Assets web (css, fonts, logo) solo si se genera HTML
    const generateHtml = ctx.siteConfig.format?.html?.generate === true;

    progress.startPhase('discovery');
    const [{ docs: allDocs, changedPaths: discoveredChanges, deletedEntries }, cssPath] = await Promise.all([
      runDiscovery(cwd, ctx, options.noCache),
      generateHtml
        ? buildAssets(ctx.outputDir, ctx.cwd, ctx.siteConfig, {
            noTailwind: options.noTailwind,
          })
        : Promise.resolve(''),
    ]);
    ctx.cssPath = cssPath;
    progress.completePhase(allDocs.length);

    // ── Filtrado incremental ──
    // Identifica archivos modificados por mtime/hash y limita el pipeline
    // a los docs afectados. Los no modificados conservan sus archivos en
    // dist sin reprocesarse.
    const GLOBAL_CHANGE_PATTERNS = [/\.ya?ml$/, /\.html$/];
    const changedPaths = options.changedPaths ?? discoveredChanges;
    const noChanges = changedPaths.size === 0;
    const isGlobalChange = !noChanges && [...changedPaths].some((p) => GLOBAL_CHANGE_PATTERNS.some((re) => re.test(p)));
    const affectedPaths = !isGlobalChange && !noChanges ? computeAffectedDocs(changedPaths, allDocs) : null;
    const pipelineDocs = affectedPaths ? allDocs.filter((d) => affectedPaths.has(d.relativePath)) : allDocs;

    const totalDocCount = allDocs.length;

    if (noChanges && !affectedPaths) {
      log('Ningun documento modificado — sin cambios');
      progress.finish(0, totalDocCount, []);
      return;
    }

    // ── FASE 2: tex ──
    // Convierte markdown a .tex solo para docs afectados. Los no modificados
    // ya tienen su .tex en cache del build anterior.
    if (pipelineDocs.length > 0) {
      const docsWithMd = await renderLatex(pipelineDocs, ctx.concurrency ?? 4, cwd, ctx.siteConfig.disabledTranspilers);
      const mdMap = new Map<string, BuildDocument>(docsWithMd.map((d) => [d.relativePath, d]));
      for (const doc of allDocs) {
        const processed = mdMap.get(doc.relativePath);
        if (processed && processed.processedBody) {
          doc.processedBody = processed.processedBody;
        }
      }
    }

    // Limpiar archivos de documentos markdown eliminados del disco.
    {
      const allDocPathsSet = new Set(allDocs.map((d) => d.relativePath));
      const deletedPaths = [...changedPaths].filter((p) => p.endsWith('.md') && !allDocPathsSet.has(p));
      if (deletedPaths.length > 0) {
        const cacheBase = join(ctx.cwd, '.iteraciones');
        for (const relPath of deletedPaths) {
          const dir = dirname(relPath);
          const entry = deletedEntries.get(relPath);
          const slug = entry ? (computeSlug({ ...entry, relativePath: relPath }) ?? basename(relPath, '.md')) : basename(relPath, '.md');
          await rm(join(cacheBase, 'tex', dir, `${slug}.tex`), { force: true }).catch(() => {});
          await rm(join(cacheBase, 'formats', 'pdf', dir, slug), { recursive: true, force: true }).catch(() => {});
          await rm(join(cacheBase, 'formats', 'html', dir, slug), { recursive: true, force: true }).catch(() => {});
          for (const ext of ['.html', '.tex', '.pdf', '.epub', '.md']) {
            await rm(join(ctx.outputDir, dir, `${slug}${ext}`), { force: true }).catch(() => {});
          }
        }
      }
    }

    // Compute output-path slugs for all documents.
    // Los archivos llamados index.md siempre conservan su nombre (index.html).
    for (const doc of allDocs) {
      const filenameStem = basename(doc.relativePath, '.md');
      doc.slug = filenameStem === 'index' ? undefined : computeSlug(doc.frontmatter);
    }

    // Detectar slugs duplicados dentro del mismo directorio.
    // Los slugs que aparecen mas de una vez reciben sufijo -d1, -d2, -d3...
    const slugCount = new Map<string, number>();
    const allSlugs = new Set<string>();
    for (const doc of allDocs) {
      if (!doc.slug) continue;
      const key = dirname(doc.relativePath) + '/' + doc.slug;
      slugCount.set(key, (slugCount.get(key) ?? 0) + 1);
      allSlugs.add(key);
    }
    // Asignar sufijos a slugs duplicados, saltando numeros que colisionen
    // con slugs originales (ej: un titulo "mi-articulo-d1" ya existe como slug).
    for (const doc of allDocs) {
      if (!doc.slug) continue;
      const dir = dirname(doc.relativePath);
      const key = dir + '/' + doc.slug;
      const count = slugCount.get(key) ?? 0;
      if (count <= 1) continue;
      // Encontrar el menor sufijo -dN que no colisione con ningun slug original
      let n = 1;
      while (allSlugs.has(dir + '/' + doc.slug + '-d' + n)) {
        n++;
      }
      doc.slug = doc.slug + '-d' + n;
      allSlugs.add(dir + '/' + doc.slug); // registrar el nuevo slug para evitar colisiones entre duplicados
    }

    let logoSvg: string | undefined;
    let enrichedSiteCtx: TemplateContext;
    if (generateHtml) {
      logoSvg = await readLogoSvgContent(ctx);
      enrichedSiteCtx = buildEnrichedSiteContext(ctx, allDocs, logoSvg);
    } else {
      enrichedSiteCtx = buildSiteContext(ctx.siteConfig, ctx.cssPath);
    }

    const formatCfg = ctx.siteConfig.format;

    // ── Escribir .tex a cache y dist ──
    const activeFormats: PipelinePhase[] = [];
    const pdfOn = formatCfg?.pdf?.generate === true || (!!formatCfg?.html?.thumbnails && formatCfg?.pdf !== undefined);
    const latexOn = formatCfg?.latex?.generate === true;
    if (latexOn && !options.noExport) activeFormats.push('latex');
    if (pdfOn && !options.noExport) activeFormats.push('pdf');
    if (formatCfg?.html?.generate === true) activeFormats.push('html');
    if (formatCfg?.epub?.generate && !options.noExport) activeFormats.push('epub');
    if (formatCfg?.markdown?.generate && !options.noExport) activeFormats.push('markdown');
    progress.setFormatPhases(activeFormats);

    if (activeFormats.includes('latex')) {
      progress.startPhase('latex', pipelineDocs.length);
    }
    await writeTexFiles(pipelineDocs, ctx, log);
    if (activeFormats.includes('latex')) {
      progress.completePhase();
    }

    // ── FASE 3: latex-to-html ──
    // Convierte .tex a HTML fragment, procesa bloques y construye contextos.
    // Solo se ejecuta si html.generate o epub.generate estan activos.
    const needsHtmlRender = formatCfg?.html?.generate === true;
    const needsRender = needsHtmlRender || formatCfg?.epub?.generate === true;
    let allContextDocs: BuildDocument[] = pipelineDocs;
    let renderedMap = new Map<DocumentType, BuildDocument[]>();
    if (needsRender) {
      progress.startPhase('render', pipelineDocs.length);
      const result = await runPrimaryRender(pipelineDocs, ctx, cwd);
      const primaryRendered = new Map<DocumentType, BuildDocument[]>([
        ['file', result.renderedFileDocs],
        ['author', result.renderedAuthorDocs],
        ['event', result.renderedEventDocs],
      ]);
      const authorDocumentIndex = result.authorDocumentIndex;

      // Escribir htmlFragment a disco
      for (const [, docs] of primaryRendered) {
        for (const doc of docs) {
          if (!doc.htmlFragment || !doc.slug) continue;
          const htmlDir = join(ctx.cwd, '.iteraciones', 'formats', 'html', dirname(doc.relativePath), doc.slug);
          await mkdir(htmlDir, { recursive: true });
          await Bun.write(join(htmlDir, 'index.html'), doc.htmlFragment);
        }
      }

      if (needsHtmlRender) {
        const { renderedBlockDocs } = await runBlocksPrestep(pipelineDocs, ctx, enrichedSiteCtx, primaryRendered, authorDocumentIndex, cwd);
        const contextResult = await runContextPhaseWithTypeGraph(pipelineDocs, ctx, enrichedSiteCtx, primaryRendered, authorDocumentIndex, cwd);
        allContextDocs = contextResult.allContextDocs;
        renderedMap = contextResult.renderedMap;
      } else {
        // Sin HTML: poblar renderedMap para exportacion (PDF, EPUB, MD)
        const byType = new Map<DocumentType, BuildDocument[]>();
        for (const doc of pipelineDocs) {
          const type = doc.type ?? 'file';
          const list = byType.get(type);
          if (list) list.push(doc);
          else byType.set(type, [doc]);
        }
        renderedMap = byType;
      }
      progress.completePhase();
    } else {
      // Sin render HTML/EPUB: renderedMap desde pipelineDocs para exportacion
      const byType = new Map<DocumentType, BuildDocument[]>();
      for (const doc of pipelineDocs) {
        const type = doc.type ?? 'file';
        const list = byType.get(type);
        if (list) list.push(doc);
        else byType.set(type, [doc]);
      }
      renderedMap = byType;
    }

    // Filtrar docs afectados para compose/write (solo HTML)
    const finalContextDocs = affectedPaths ? allContextDocs.filter((d) => affectedPaths.has(d.relativePath)) : allContextDocs;

    // ── FASE 4: export ──
    const noExport = options.noExport === true;
    const exportRenderedMap = affectedPaths
      ? new Map<DocumentType, BuildDocument[]>(
          [...renderedMap].map(([type, docs]) => [type, docs.filter((doc) => affectedPaths.has(doc.relativePath))]),
        )
      : renderedMap;

    const exportBase = {
      outputDir: ctx.outputDir,
      cwd,
      lang: ctx.siteConfig.lang,
      concurrency: ctx.concurrency ?? 4,
      onExportProgress: (relativePath: string) =>
        progress.reportFile({
          relativePath,
          durationMs: 0,
          cacheHit: false,
          phase: 'pdf',
        }),
    };
    const exportResults: ExportResult[] = [];

    // Calcular total de docs exportables por formato
    const countExportDocs = (type: DocumentType): number => {
      const docs = (renderedMap.get(type) ?? []).filter((d) => d.kind !== 'block');
      let count = 0;
      for (const d of docs) {
        const raw = d.frontmatter['export'];
        const skipped = typeof raw === 'object' && raw !== null && !Array.isArray(raw) && (raw as Record<string, unknown>)['skip'] === true;
        if (skipped) continue;
        count += d.type === 'author' ? 2 : 1;
      }
      return count;
    };

    if (pdfOn && !noExport) {
      let pdfTotal = 0;
      for (const type of EXPORTABLE_TYPES) {
        pdfTotal += countExportDocs(type);
      }
      progress.startPhase('pdf', pdfTotal);
      const pdfResults = await runExportDocuments(exportRenderedMap, {
        ...exportBase,
        config: formatCfg,
      });
      exportResults.push(...pdfResults);
      if (pdfTotal > 0) progress.log(`PDF: ${pdfTotal} generados`);
      progress.completePhase();
    }

    // ── Fase html (final) ──
    if (formatCfg?.html?.generate === true) {
      progress.startPhase('html', finalContextDocs.length);
      const docsWithLinks = finalContextDocs;
      // Inyectar enlaces de descarga
      let docsWithExportLinks = finalContextDocs;
      if (exportResults.length > 0) {
        docsWithExportLinks = injectDownloadLinks(finalContextDocs, exportResults, ctx.outputDir);
        docsWithExportLinks = injectDownloadLinksIntoListItems(docsWithExportLinks);
        docsWithExportLinks = injectCoverIntoListItems(docsWithExportLinks);
      }

      await runFinalization(docsWithExportLinks, ctx, log);
      progress.completePhase();
    }

    // ── Fase epub ──
    if (formatCfg?.epub?.generate && !noExport) {
      let epubTotal = 0;
      for (const type of EXPORTABLE_TYPES) {
        epubTotal += countExportDocs(type);
      }
      progress.startPhase('epub', epubTotal);
      const epubResults = await runExportDocuments(exportRenderedMap, {
        ...exportBase,
        config: formatCfg,
      });
      exportResults.push(...epubResults);
      if (epubTotal > 0) progress.log(`EPUB: ${epubTotal} generados`);
      progress.completePhase();
    }

    // ── Fase markdown ──
    if (formatCfg?.markdown?.generate && !noExport) {
      let mdTotal = 0;
      for (const type of EXPORTABLE_TYPES) {
        const docs = (renderedMap.get(type) ?? []).filter((d) => d.kind !== 'block');
        for (const d of docs) {
          const raw = d.frontmatter['export'];
          const skipped = typeof raw === 'object' && raw !== null && !Array.isArray(raw) && (raw as Record<string, unknown>)['skip'] === true;
          if (skipped) continue;
          mdTotal++;
        }
      }
      progress.startPhase('markdown', mdTotal);
      const mdResults = await runExportDocuments(exportRenderedMap, {
        ...exportBase,
        config: formatCfg,
      });
      exportResults.push(...mdResults);
      if (mdTotal > 0) progress.log(`Markdown: ${mdTotal} generados`);
      progress.completePhase();
    }

    const htmlOn = formatCfg?.html?.generate === true;
    const mdOn = formatCfg?.markdown?.generate === true;
    const epubOn = formatCfg?.epub?.generate === true;
    // latexOn y pdfOn ya declarados arriba
    const totalDocs = htmlOn || pdfOn || epubOn || mdOn || latexOn ? totalDocCount : 0;
    const processedCount = noChanges ? 0 : affectedPaths ? affectedPaths.size : totalDocs;
    const cachedCount = totalDocs - processedCount;
    const generatedFormats: string[] = [];
    if (latexOn) generatedFormats.push('latex');
    if (pdfOn) generatedFormats.push('pdf');
    if (htmlOn) generatedFormats.push('html');
    if (epubOn) generatedFormats.push('epub');
    if (mdOn) generatedFormats.push('markdown');
    progress.finish(processedCount, cachedCount, generatedFormats);

    // Limpiar archivos de formatos desactivados en dist para cada documento.
    // Itera sobre allDocs (todos los markdown del proyecto) y elimina los
    // archivos de exportacion de formatos que ya no estan activos.
    if (!options.noCache) {
      for (const doc of allDocs) {
        const dir = dirname(doc.relativePath);
        const slug = doc.slug ?? basename(doc.relativePath, '.md');
        const base = join(ctx.outputDir, dir, slug);
        if (!latexOn) await rm(base + '.tex', { force: true }).catch(() => {});
        if (!pdfOn) await rm(base + '.pdf', { force: true }).catch(() => {});
        if (!epubOn) await rm(base + '.epub', { force: true }).catch(() => {});
        if (!mdOn) await rm(base + '.md', { force: true }).catch(() => {});
        if (!htmlOn) await rm(base + '.html', { force: true }).catch(() => {});
      }
    }

    // Limpiar carpetas de cache de formatos que ya no estan activos.
    // --no-cache ya limpio toda la cache al inicio, por lo que este paso
    // solo aplica en builds normales donde se desactivo un formato.
    if (!options.noCache) {
      const cacheBase = join(cwd, '.iteraciones');
      const needsTex =
        formatCfg?.pdf?.generate === true || (!!formatCfg?.html?.thumbnails && formatCfg?.pdf !== undefined) || formatCfg?.latex?.generate === true;
      const needsHtml = formatCfg?.html?.generate === true || formatCfg?.epub?.generate === true;
      if (!needsTex) {
        await rm(join(cacheBase, 'tex'), { recursive: true, force: true }).catch(() => {});
        await rm(join(cacheBase, 'formats', 'pdf'), { recursive: true, force: true }).catch(() => {});
      }
      if (!needsHtml) {
        await rm(join(cacheBase, 'formats', 'html'), { recursive: true, force: true }).catch(() => {});
      }
    }
  } finally {
  }
}

/**
 * Obtiene el directorio de cache global de biber ejecutando `biber --cache`.
 * Retorna null si biber no esta instalado o falla.
 */
async function getBiberCacheDir(): Promise<string | null> {
  try {
    const proc = Bun.spawn(['biber', '--cache'], { stdout: 'pipe' });
    const dir = (await new Response(proc.stdout).text()).trim();
    return dir || null;
  } catch {
    return null;
  }
}

/**
 * Limpia la cache global de biber. Se ejecuta junto con --no-cache
 * para evitar errores por stale data en compilaciones PDF con biblatex.
 */
async function clearBiberCache(): Promise<void> {
  const cacheDir = await getBiberCacheDir();
  if (cacheDir) {
    await rm(cacheDir, { recursive: true, force: true });
  }
}
