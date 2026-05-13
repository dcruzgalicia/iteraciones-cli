import type { AstNode, ForNode, IfNode, TextNode, VariableNode } from './ast.js';
import { tokenize } from './lexer.js';
import { renderAst } from './render/renderer.js';
import { type Token, TokenType } from './token-types.js';

/**
 * Convierte un stream de `Token[]` en `AstNode[]`.
 * Respeta anidamiento de `if` dentro de `for` y viceversa.
 * Los tokens IF y FOR consumen sus cuerpos de forma recursiva.
 */
export function parse(tokens: Token[]): AstNode[] {
  const { nodes } = parseNodes(tokens, 0, null);
  return nodes;
}

type StopReason = 'else' | 'endif' | 'sep' | 'endfor' | null;

function parseNodes(tokens: Token[], start: number, stopAt: StopReason): { nodes: AstNode[]; index: number; stop: StopReason } {
  const nodes: AstNode[] = [];
  let i = start;

  while (i < tokens.length) {
    const token = tokens[i]!;

    if (token.type === TokenType.TEXT) {
      nodes.push({ kind: 'text', value: token.value ?? '' } satisfies TextNode);
      i++;
      continue;
    }

    if (token.type === TokenType.ESCAPE) {
      nodes.push({ kind: 'text', value: '$' } satisfies TextNode);
      i++;
      continue;
    }

    if (token.type === TokenType.VARIABLE) {
      nodes.push({ kind: 'variable', key: token.value ?? '' } satisfies VariableNode);
      i++;
      continue;
    }

    if (token.type === TokenType.IF) {
      i++;
      const { nodes: consequent, index: afterConsequent, stop } = parseNodes(tokens, i, 'else');
      let alternate: AstNode[] = [];
      let afterAlternate = afterConsequent;

      if (stop === 'else') {
        const result = parseNodes(tokens, afterConsequent, 'endif');
        alternate = result.nodes;
        afterAlternate = result.index;
      }

      nodes.push({ kind: 'if', condition: token.value ?? '', consequent, alternate } satisfies IfNode);
      i = afterAlternate;
      continue;
    }

    if (token.type === TokenType.FOR) {
      i++;
      const { nodes: body, index: afterBody, stop } = parseNodes(tokens, i, 'sep');
      let separator: AstNode[] = [];
      let afterSeparator = afterBody;

      if (stop === 'sep') {
        const result = parseNodes(tokens, afterBody, 'endfor');
        separator = result.nodes;
        afterSeparator = result.index;
      } else {
        // no hubo $sep$, solo $endfor$
        afterSeparator = afterBody;
      }

      nodes.push({ kind: 'for', key: token.value ?? '', body, separator } satisfies ForNode);
      i = afterSeparator;
      continue;
    }

    // Tokens de cierre: ELSE, ENDIF, SEP, ENDFOR — señalan el límite del bloque actual
    if (token.type === TokenType.ELSE) {
      return { nodes, index: i + 1, stop: 'else' };
    }
    if (token.type === TokenType.ENDIF) {
      return { nodes, index: i + 1, stop: 'endif' };
    }
    if (token.type === TokenType.SEP) {
      return { nodes, index: i + 1, stop: 'sep' };
    }
    if (token.type === TokenType.ENDFOR) {
      return { nodes, index: i + 1, stop: 'endfor' };
    }

    i++;
  }

  return { nodes, index: i, stop: stopAt };
}

/**
 * Encadena tokenize → parse → renderAst.
 * stub: la implementación completa se termina en el issue #29.
 */
export function render(template: string, context: Record<string, unknown>): string {
  return renderAst(parse(tokenize(template)), context);
}
