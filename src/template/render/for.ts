import type { AstNode, ForNode } from '../ast.js';
import type { TemplateContext } from './context.js';
import { resolveValue } from './context.js';

/**
 * Renderiza un `ForNode`: itera sobre el array en `context[node.key]`,
 * renderiza `body` para cada elemento con un contexto enriquecido,
 * e inserta los nodos de `separator` entre iteraciones.
 *
 * Si el valor no es iterable (o está vacío), retorna cadena vacía.
 * Si el item es un objeto plano, sus propiedades se mezclan al contexto raíz,
 * de modo que dentro del body se accede con `$key$` o `$a.b$` directamente.
 */
export function renderFor(node: ForNode, context: TemplateContext, renderNodes: (nodes: AstNode[], ctx: TemplateContext) => string): string {
  const raw = resolveValue(context, node.key);
  const items = toIterable(raw);
  if (items.length === 0) return '';

  const parts: string[] = [];

  for (let i = 0; i < items.length; i++) {
    if (i > 0 && node.separator.length > 0) {
      parts.push(renderNodes(node.separator, context));
    }
    const itemContext = mergeContext(context, items[i], node.key);
    parts.push(renderNodes(node.body, itemContext));
  }

  return parts.join('');
}

function toIterable(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value !== null && value !== undefined) return [value];
  return [];
}

/**
 * Crea un contexto enriquecido donde el item actual tiene precedencia
 * sobre el contexto padre para resolución de claves.
 */
function mergeContext(parent: TemplateContext, item: unknown, key: string): TemplateContext {
  if (item !== null && typeof item === 'object' && Object.getPrototypeOf(item) === Object.prototype) {
    return { ...parent, ...(item as TemplateContext) };
  }
  // Para primitivos (string, número, booleano), el nombre de la variable del loop
  // debe resolver al item actual, no al array original.
  // Ej: $for(keywords)$$keywords$$sep$, $endfor$ → "tag1, tag2"
  return { ...parent, [key]: item };
}
