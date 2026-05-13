import type { VariableNode } from '../ast.js';
import { coerceToString, resolveValue, type TemplateContext } from './context.js';

export function renderVariable(node: VariableNode, context: TemplateContext): string {
  return coerceToString(resolveValue(context, node.key));
}
