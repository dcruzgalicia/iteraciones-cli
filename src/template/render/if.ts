import type { AstNode, IfNode } from '../ast.js';
import type { TemplateContext } from './context.js';
import { isTruthy, resolveValue } from './context.js';

export function renderIf(node: IfNode, context: TemplateContext, renderNodes: (nodes: AstNode[], ctx: TemplateContext) => string): string {
  const value = resolveValue(context, node.condition);
  const branch = isTruthy(value) ? node.consequent : node.alternate;
  return renderNodes(branch, context);
}
