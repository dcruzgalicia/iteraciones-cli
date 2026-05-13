import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { mapWithConcurrency } from '../../output/concurrency.js';
import { tokenize } from '../../template/lexer.js';
import { parse } from '../../template/parser.js';
import { renderAst } from '../../template/render/renderer.js';
import type { BuildContext, BuildDocument } from '../types.js';

const LAYOUT_PATH = join(import.meta.dir, '../../../layouts/default.html');
const PANDOC_TEMPLATE_PATH = join(import.meta.dir, '../../../pandoc/template.html');

export async function composeDocuments(docs: BuildDocument[], ctx: BuildContext): Promise<BuildDocument[]> {
  const layoutTemplate = await readFile(LAYOUT_PATH, 'utf8');
  const pandocTemplate = await readFile(PANDOC_TEMPLATE_PATH, 'utf8');

  if (!layoutTemplate.includes('$body$')) {
    throw new Error(`El layout en "${LAYOUT_PATH}" no contiene el marcador $body$`);
  }

  // Pre-parsear ambos templates una sola vez.
  const layoutAst = parse(tokenize(layoutTemplate));
  const pandocAst = parse(tokenize(pandocTemplate));

  return mapWithConcurrency(docs, ctx.concurrency ?? 4, async (doc) => {
    if (!doc.templateContext) {
      throw new Error(`composeDocuments: templateContext no definido en "${doc.relativePath}"`);
    }
    if (doc.htmlFragment === undefined) {
      throw new Error(`composeDocuments: htmlFragment no definido en "${doc.relativePath}"`);
    }

    // Paso 1: renderizar el layout (header + main + footer) con el contexto del documento.
    // doc.templateContext ya contiene body: htmlFragment, puesto por buildDocumentContext.
    const layoutHtml = renderAst(layoutAst, doc.templateContext);

    // Paso 2: envolver el layout en el documento HTML completo (doctype, head, link CSS).
    // body se sobreescribe con el HTML del layout; el resto de vars vienen del templateContext.
    const outputHtml = renderAst(pandocAst, { ...doc.templateContext, body: layoutHtml });

    return { ...doc, outputHtml };
  });
}
