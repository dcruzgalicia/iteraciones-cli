import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { mapWithConcurrency } from '../../output/concurrency.js';
import { tokenize } from '../../template/lexer.js';
import { parse } from '../../template/parser.js';
import { renderAst } from '../../template/render/renderer.js';
import type { BuildContext, BuildDocument } from '../types.js';

const LAYOUT_PATH = join(import.meta.dir, '../../../layouts/default.html');

export async function composeDocuments(docs: BuildDocument[], ctx: BuildContext): Promise<BuildDocument[]> {
  const layoutTemplate = await readFile(LAYOUT_PATH, 'utf8');

  if (!layoutTemplate.includes('$body$')) {
    throw new Error(`El layout en "${LAYOUT_PATH}" no contiene el marcador $body$`);
  }

  // Pre-parsear el layout completo una sola vez: evita parseos repetidos y soporta
  // bloques $if/$for que crucen el marcador $body$ sin desbalancear el AST.
  const ast = parse(tokenize(layoutTemplate));

  return mapWithConcurrency(docs, ctx.concurrency ?? 4, async (doc) => {
    if (!doc.templateContext) {
      throw new Error(`composeDocuments: templateContext no definido en "${doc.relativePath}"`);
    }
    if (doc.htmlFragment === undefined) {
      throw new Error(`composeDocuments: htmlFragment no definido en "${doc.relativePath}"`);
    }

    // doc.templateContext ya contiene body: htmlFragment, puesto por buildDocumentContext.
    const outputHtml = renderAst(ast, doc.templateContext);
    return { ...doc, outputHtml };
  });
}
