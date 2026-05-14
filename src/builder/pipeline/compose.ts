import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { mapWithConcurrency } from '../../output/concurrency.js';
import type { AstNode } from '../../template/ast.js';
import { tokenize } from '../../template/lexer.js';
import { parse } from '../../template/parser.js';
import { renderAst } from '../../template/render/renderer.js';
import type { BuildContext, BuildDocument } from '../types.js';

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

async function readAndParseTemplate(path: string): Promise<AstNode[]> {
  const content = await readFile(path, 'utf8');
  return parse(tokenize(content));
}

export async function composeDocuments(docs: BuildDocument[], ctx: BuildContext): Promise<BuildDocument[]> {
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

  // Pre-parsear los templates por tipo (únicos) para no releer el mismo archivo por cada doc.
  const uniqueTemplatePaths = [...new Set(docs.map((d) => d.templatePath).filter((p): p is string => !!p))];
  const templateAstMap = new Map<string, AstNode[]>(
    await Promise.all(uniqueTemplatePaths.map(async (p) => [p, await readAndParseTemplate(p)] as const)),
  );

  return mapWithConcurrency(docs, ctx.concurrency ?? 4, async (doc) => {
    if (!doc.templateContext) {
      throw new Error(`composeDocuments: templateContext no definido en "${doc.relativePath}"`);
    }
    if (doc.htmlFragment === undefined) {
      throw new Error(`composeDocuments: htmlFragment no definido en "${doc.relativePath}"`);
    }

    // Paso 1: renderizar el template específico del tipo de documento (templates/{type}.html).
    // El template usa $body$ para el htmlFragment y puede añadir estructura adicional (encabezados, listas).
    const typeAst = doc.templatePath ? templateAstMap.get(doc.templatePath) : undefined;
    const innerHtml = typeAst ? renderAst(typeAst, doc.templateContext) : ((doc.templateContext.body as string) ?? '');

    // Paso 2: envolver el HTML del tipo en el layout del sitio (header de navegación, main, footer).
    const layoutHtml = renderAst(layoutAst, { ...doc.templateContext, body: innerHtml });

    // Paso 3: envolver el layout en el documento HTML completo (doctype, head, link CSS).
    const outputHtml = renderAst(pandocAst, { ...doc.templateContext, body: layoutHtml });

    return { ...doc, outputHtml };
  });
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
    await Promise.all(uniqueTemplatePaths.map(async (p) => [p, await readAndParseTemplate(p)] as const)),
  );

  const regionMap = new Map<string, string[]>();

  for (const doc of blockDocs) {
    const region = doc.frontmatter.region;
    if (!region || !VALID_REGIONS.has(region) || !doc.templateContext || doc.htmlFragment === undefined) continue;

    const typeAst = doc.templatePath ? templateAstMap.get(doc.templatePath) : undefined;
    const innerHtml = typeAst ? renderAst(typeAst, doc.templateContext) : ((doc.templateContext.body as string) ?? '');

    const parts = regionMap.get(region) ?? [];
    parts.push(innerHtml);
    regionMap.set(region, parts);
  }

  return Object.fromEntries([...regionMap.entries()].map(([region, parts]) => [region, parts.join('\n')]));
}
