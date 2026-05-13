export type TemplateContext = Record<string, unknown>;

/**
 * Resuelve `name` (puede ser `"key"` o `"array.key"`) en el contexto.
 * Devuelve `undefined` si no existe ninguna ruta válida.
 */
export function resolveValue(context: TemplateContext, name: string): unknown {
  const path = name
    .split('.')
    .map((p) => p.trim())
    .filter(Boolean);
  if (path.length === 0) return undefined;

  let current: unknown = context;
  for (const segment of path) {
    if (!current || typeof current !== 'object' || !(segment in (current as Record<string, unknown>))) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * Coerce a valor de string para usarse en la salida del template.
 * `undefined`/`null` → `""`, booleano `false` → `""`, objetos → `"true"`.
 */
export function coerceToString(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'boolean') return value ? 'true' : '';
  if (Array.isArray(value)) return value.map(coerceToString).join('');
  if (typeof value === 'object') return 'true';
  return String(value);
}

/**
 * Evalúa truthiness de un valor del contexto para condicionales.
 */
export function isTruthy(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'string') return value.length > 0;
  if (typeof value === 'boolean') return value;
  if (value && typeof value === 'object') return true;
  return false;
}
