import { type Token, TokenType } from './token-types.js';

/**
 * Convierte una cadena de template en un array de `Token`.
 *
 * Constructos reconocidos:
 *   $var$          → VARIABLE  (value = nombre)
 *   $if(k)$        → IF        (value = clave de condición)
 *   $else$         → ELSE
 *   $endif$        → ENDIF
 *   $for(k)$       → FOR       (value = clave del array)
 *   $sep$          → SEP
 *   $endfor$       → ENDFOR
 *   $$             → ESCAPE    (representa un `$` literal; nunca aparece dentro de TEXT)
 *   texto plano    → TEXT      (value = texto literal entre tokens)
 */
export function tokenize(template: string): Token[] {
  const tokens: Token[] = [];
  let cursor = 0;
  let textStart = cursor;

  const flushText = (end: number) => {
    if (end > textStart) {
      tokens.push({ type: TokenType.TEXT, value: template.slice(textStart, end) });
    }
  };

  while (cursor < template.length) {
    const open = template.indexOf('$', cursor);

    if (open === -1) {
      // No quedan más `$` — resto del texto
      flushText(template.length);
      break;
    }

    // `$$` escape
    if (template[open + 1] === '$') {
      flushText(open);
      tokens.push({ type: TokenType.ESCAPE });
      cursor = open + 2;
      textStart = cursor;
      continue;
    }

    const close = template.indexOf('$', open + 1);
    if (close === -1) {
      // `$` sin cierre — tratamos el resto como texto
      flushText(template.length);
      break;
    }

    // Hay texto literal antes del token
    flushText(open);

    const inner = template.slice(open + 1, close).trim();
    tokens.push(classifyToken(inner));

    cursor = close + 1;
    textStart = cursor;
  }

  return tokens;
}

function classifyToken(inner: string): Token {
  if (inner === 'else') return { type: TokenType.ELSE };
  if (inner === 'endif') return { type: TokenType.ENDIF };
  if (inner === 'sep') return { type: TokenType.SEP };
  if (inner === 'endfor') return { type: TokenType.ENDFOR };
  if (inner.startsWith('if(') && inner.endsWith(')')) return { type: TokenType.IF, value: inner.slice(3, -1).trim() };
  if (inner.startsWith('for(') && inner.endsWith(')')) return { type: TokenType.FOR, value: inner.slice(4, -1).trim() };
  return { type: TokenType.VARIABLE, value: inner };
}
