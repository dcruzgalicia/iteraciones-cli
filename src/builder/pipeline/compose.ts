import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { mapWithConcurrency } from '../../output/concurrency.js';
import type { AstNode } from '../../template/ast.js';
import { tokenize } from '../../template/lexer.js';
import { parse } from '../../template/parser.js';
import { renderAst } from '../../template/render/renderer.js';
import type { BuildContext, BuildDocument } from '../types.js';

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
