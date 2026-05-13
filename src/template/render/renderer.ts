import type { AstNode } from '../ast.js';
import type { TemplateContext } from './context.js';
import { renderFor } from './for.js';
import { renderIf } from './if.js';
import { renderVariable } from './variables.js';

export type { TemplateContext };

/**
 * Camina `AstNode[]` y despacha cada nodo al render correspondiente.
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
    if (node.kind === 'if') {
      parts.push(renderIf(node, context, renderAst));
      continue;
    }
    if (node.kind === 'for') {
      parts.push(renderFor(node, context, renderAst));
      continue;
    }
    // Si se llega aquí, el parser emitió un nodo de tipo desconocido.
    throw new Error(`Tipo de nodo no soportado: "${(node as AstNode).kind}"`);
  }

  return parts.join('');
}
