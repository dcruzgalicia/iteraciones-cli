import type { IfNode } from '../ast.js';
import type { TemplateContext } from './context.js';
import { isTruthy, resolveValue } from './context.js';
import { renderAst } from './renderer.js';

export function renderIf(node: IfNode, context: TemplateContext): string {
  const value = resolveValue(context, node.condition);
  const branch = isTruthy(value) ? node.consequent : node.alternate;
  return renderAst(branch, context);
}
