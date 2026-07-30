import { blockContent, blocksToLatex, hasClass } from './_ast-utils.js';

export const type = 'ast' as const;

async function processFlushright(block: Record<string, unknown>): Promise<unknown> {
  const content = blockContent(block);
  const latex = await blocksToLatex(content);
  return { t: 'RawBlock', c: ['latex', `\\begin{flushright}\n${latex}\n\\end{flushright}`] };
}

export async function transform(ast: Record<string, unknown>): Promise<Record<string, unknown>> {
  const blocks = ast.blocks as unknown[];
  const newBlocks: unknown[] = [];
  for (const block of blocks) {
    if (
      typeof block === 'object' &&
      block !== null &&
      (block as Record<string, unknown>).t === 'Div' &&
      hasClass(block as Record<string, unknown>, 'flushright')
    ) {
      newBlocks.push(await processFlushright(block as Record<string, unknown>));
    } else {
      newBlocks.push(block);
    }
  }
  ast.blocks = newBlocks;
  return ast;
}
