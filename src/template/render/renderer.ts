import type { AstNode } from '../ast.js';
import type { TemplateContext } from './context.js';
import { renderVariable } from './variables.js';

export type { TemplateContext };

/**
 * Camina `AstNode[]` y despacha cada nodo al render correspondiente.
 * stub: if y for se agregan en los issues #28 y #29.
 */
export function renderAst(nodes: AstNode[], context: TemplateContext): string {
  const parts: string[] = [];

  for (const node of nodes) {
    if (node.kind === 'text') {
      parts.push(node.value);
      continue;
    }
    if (node.kind === 'variable') {
      parts.push(renderVariable(node, context));
      continue;
    }
    // stub: IfNode → issue #28, ForNode → issue #29
    throw new Error(`Tipo de nodo no soportado en este stub: "${node.kind}" (se implementa en los issues #28 y #29)`);
  }

  return parts.join('');
}
