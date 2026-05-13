import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { mapWithConcurrency } from '../../output/concurrency.js';
import { tokenize } from '../../template/lexer.js';
import { parse } from '../../template/parser.js';
import { renderAst } from '../../template/render/renderer.js';
import type { BuildContext, BuildDocument } from '../types.js';

const LAYOUT_PATH = join(import.meta.dir, '../../../layouts/default.html');

/** Divide el template en las partes antes y después del marcador `$body$`. */
function splitAtBody(template: string): { before: string; after: string } {
  const MARKER = '$body$';
  const idx = template.indexOf(MARKER);
  if (idx === -1) return { before: template, after: '' };
  return { before: template.slice(0, idx), after: template.slice(idx + MARKER.length) };
}

export async function composeDocuments(docs: BuildDocument[], ctx: BuildContext): Promise<BuildDocument[]> {
  const layoutTemplate = await readFile(LAYOUT_PATH, 'utf8');
  const { before, after } = splitAtBody(layoutTemplate);

  // Pre-parsear fuera del loop: cada documento comparte la misma estructura de template.
  const beforeAst = parse(tokenize(before));
  const afterAst = parse(tokenize(after));

  return mapWithConcurrency(docs, ctx.concurrency ?? 4, async (doc) => {
    if (!doc.templateContext) {
      throw new Error(`composeDocuments: templateContext no definido en "${doc.relativePath}"`);
    }
    if (doc.htmlFragment === undefined) {
      throw new Error(`composeDocuments: htmlFragment no definido en "${doc.relativePath}"`);
    }

    const beforeHtml = renderAst(beforeAst, doc.templateContext);
    const afterHtml = renderAst(afterAst, doc.templateContext);
    const outputHtml = beforeHtml + doc.htmlFragment + afterHtml;

    return { ...doc, outputHtml };
  });
}
