/**
 * Renderiza markdown inline básico a HTML.
 *
 * Soporta:
 *   - `**texto**` → `<strong>texto</strong>`
 *   - `*texto*`   → `<em>texto</em>`
 *
 * No procesa bloques (headers, listas, etc.) — solo sintaxis inline.
 * El resultado NO está HTML-escaped: contiene etiquetas HTML literales.
 */
export function renderMarkdownInline(text: string): string {
  // Negritas: **texto** → <strong>texto</strong>
  text = text.replace(/\*\*(.+?)\*\*/g, (_match: string, inner: string) => {
    return `<strong>${escapeHtml(inner)}</strong>`;
  });

  // Cursivas: *texto* → <em>texto</em>
  // Debe ejecutarse después de negritas para no interferir con **
  text = text.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, (_match: string, inner: string) => {
    return `<em>${escapeHtml(inner)}</em>`;
  });

  // Código inline: `codigo` → <code>codigo</code>
  text = text.replace(/`([^`]+)`/g, (_match: string, inner: string) => {
    return `<code>${escapeHtml(inner)}</code>`;
  });

  return text;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
