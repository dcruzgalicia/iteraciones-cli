/**
 * Renderiza markdown inline a comandos LaTeX.
 *
 * Soporta:
 *   - `**texto**` → `\\textbf{texto}`
 *   - `*texto*`   → `\\textit{texto}`
 *   - `` `codigo` `` → `\\texttt{codigo}`
 *
 * El contenido interno se escapa para LaTeX.
 * El texto fuera de los spans markdown también se escapa.
 */
export function renderMarkdownInlineLatex(text: string): string {
  const markers: string[] = [];

  // Negritas: **texto** → \textbf{texto}
  text = text.replace(/\*\*(.+?)\*\*/g, (_match: string, inner: string) => {
    const idx = markers.length;
    markers.push(`\\textbf{${escapeLatex(inner)}}`);
    return `\x00MD${idx}\x00`;
  });

  // Cursivas: *texto* → \textit{texto}
  // Debe ejecutarse después de negritas para no interferir con **
  text = text.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, (_match: string, inner: string) => {
    const idx = markers.length;
    markers.push(`\\textit{${escapeLatex(inner)}}`);
    return `\x00MD${idx}\x00`;
  });

  // Código inline: `codigo` → \texttt{codigo}
  text = text.replace(/`([^`]+)`/g, (_match: string, inner: string) => {
    const idx = markers.length;
    markers.push(`\\texttt{${escapeLatex(inner)}}`);
    return `\x00MD${idx}\x00`;
  });

  // Escapar el texto restante
  text = escapeLatex(text);

  // Restaurar placeholders
  for (let i = 0; i < markers.length; i++) {
    const restored = markers[i];
    if (restored !== undefined) {
      text = text.replace(`\x00MD${i}\x00`, restored);
    }
  }

  return text;
}

/**
 * Escapa caracteres especiales de LaTeX.
 */
function escapeLatex(s: string): string {
  return s
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/{/g, '\\{')
    .replace(/}/g, '\\}')
    .replace(/\$/g, '\\$')
    .replace(/&/g, '\\&')
    .replace(/#/g, '\\#')
    .replace(/\^/g, '\\textasciicircum{}')
    .replace(/_/g, '\\_')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/%/g, '\\%');
}
