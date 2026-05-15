import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CacheManager } from '../../cache/cache-manager.js';
import { hash } from '../../cache/hasher.js';
import { mapWithConcurrency } from '../../output/concurrency.js';
import type { PluginRegistry } from '../../plugin/registry.js';
import type { AstNode } from '../../template/ast.js';
import { tokenize } from '../../template/lexer.js';
import { parse } from '../../template/parser.js';
import type { TemplateContext } from '../../template/render/context.js';
import { renderAst } from '../../template/render/renderer.js';
import type { BuildContext, BuildDocument } from '../types.js';

export interface ComposeCache {
  manager: CacheManager;
  cliVersion: string;
}

const VALID_REGIONS = new Set([
  'content-before',
  'content-after',
  'sidebar-primary',
  'sidebar-secondary',
  'footer-left',
  'footer-center',
  'footer-right',
]);

const LAYOUT_PATH = join(import.meta.dir, '../../../layouts/default.html');
const PANDOC_TEMPLATE_PATH = join(import.meta.dir, '../../../pandoc/template.html');

async function readAndParseTemplate(path: string): Promise<{ ast: AstNode[]; contentHash: string }> {
  const content = await readFile(path, 'utf8');
  return { ast: parse(tokenize(content)), contentHash: hash(content) };
}

export async function composeDocuments(
  docs: BuildDocument[],
  ctx: BuildContext,
  cache?: ComposeCache,
  registry?: PluginRegistry,
): Promise<BuildDocument[]> {
  const layoutTemplate = await readFile(LAYOUT_PATH, 'utf8');
  const pandocTemplate = await readFile(PANDOC_TEMPLATE_PATH, 'utf8');

  if (!layoutTemplate.includes('$body$')) {
    throw new Error(`El layout en "${LAYOUT_PATH}" no contiene el marcador $body$`);
  }
  if (!pandocTemplate.includes('$body$')) {
    throw new Error(`El pandoc template en "${PANDOC_TEMPLATE_PATH}" no contiene el marcador $body$`);
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

  const activeComposeKeys = cache ? new Set<string>() : null;

  const result = await mapWithConcurrency(docs, ctx.concurrency ?? 4, async (doc) => {
    if (!doc.templateContext) {
      throw new Error(`composeDocuments: templateContext no definido en "${doc.relativePath}"`);
    }
    if (doc.htmlFragment === undefined) {
      throw new Error(`composeDocuments: htmlFragment no definido en "${doc.relativePath}"`);
    }

    const typeTemplateHash = doc.templatePath ? (templateDataMap.get(doc.templatePath)?.contentHash ?? '') : '';
    const key = cache ? hash(doc.htmlFragment, JSON.stringify(doc.templateContext), cache.cliVersion, layoutHash, pandocHash, typeTemplateHash) : '';

    if (cache) {
      activeComposeKeys!.add(key);
      const cached = await cache.manager.read('compose', key);
      if (cached !== undefined) {
        return { ...doc, outputHtml: cached };
      }
    }

    // beforeCompose: permite al plugin modificar el templateContext antes de renderizar.
    // La clave de caché se calcula sobre el contexto original; las modificaciones del
    // plugin se persisten en el resultado cacheado (válido para plugins deterministas).
    let effectiveTemplateContext: TemplateContext = doc.templateContext;
    if (registry) {
      const beforeCtx = await registry.runBeforeCompose({
        outputRelativePath: doc.relativePath,
        templateContext: doc.templateContext as Readonly<Record<string, unknown>>,
      });
      effectiveTemplateContext = beforeCtx.templateContext as TemplateContext;
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
      const afterCtx = await registry.runAfterCompose({ outputRelativePath: doc.relativePath, html: outputHtml });
      outputHtml = afterCtx.html;
    }

    if (cache) {
      await cache.manager.write('compose', key, outputHtml);
    }

    return { ...doc, outputHtml };
  });

  // Podar entradas obsoletas del scope 'compose' al final, una vez que todas las claves
  // activas han sido registradas. Se hace aquí y no en el orchestrator porque la fórmula
  // de la clave depende de los hashes de templates que solo se conocen dentro de esta función.
  if (cache && activeComposeKeys) {
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
      console.warn(`[iteraciones] bloque "${doc.relativePath}" no tiene frontmatter.region — se omite.`);
      continue;
    }
    if (!VALID_REGIONS.has(region)) {
      console.warn(
        `[iteraciones] bloque "${doc.relativePath}" tiene región inválida "${region}". ` + `Valores permitidos: ${[...VALID_REGIONS].join(', ')}.`,
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
