import type { IPlugin } from "../../src/plugin/types.js";

/**
 * Plugin built-in `dictum-plugin` para iteraciones-cli.
 *
 * Transforma fenced divs con clase `.dictum` en el comando LaTeX
 * `\dictum[author]{quote}` durante la exportación PDF.
 *
 * Detecta dictums consecutivos para reducir el espaciado entre ellos:
 * - Si un dictum va seguido de otro dictum → `\vspace*{2\topskip}`
 * - Si es el último dictum o va seguido de párrafo → `\vspace*{3\topskip}`
 *
 * Se registra automáticamente en todos los builds; no es necesario
 * declararlo en `_iteraciones.yaml`.
 *
 * ## Uso en Markdown
 *
 * ```markdown
 * ::: {.dictum}
 * Dios hizo los números enteros, el resto es obra del hombre.
 *
 * Leopold Kronecker
 * :::
 * ```
 *
 * La última línea se usa como autor (argumento opcional de `\dictum`).
 * Si solo hay una línea, se omite el autor.
 */

/** Regex que captura un fenced div de Pandoc con clase `.dictum`. */
const DICTUM_RE = /:::\s*\{\.dictum[^}]*\}\n([\s\S]*?)\n:::/g;

/**
 * Regex para detectar si entre dos dictums solo hay espacios/blank lines.
 * Captura cualquier texto entre el cierre `:::` de un dictum
 * y la apertura del siguiente.
 */
const CONSECUTIVE_GAP_RE = /^[ \t]*\n+[ \t]*$/;

interface DictumMatch {
  /** Índice de inicio del match completo en el body. */
  index: number;
  /** Longitud del match completo. */
  length: number;
  /** Contenido capturado (entre los `:::`). */
  content: string;
}

/**
 * Convierte formato inline markdown (negritas y cursivas) a comandos LaTeX,
 * antes de aplicar escapeLatex. Usa placeholders para proteger los comandos
 * LaTeX producidos del escape posterior.
 */
function renderMarkdownInline(text: string): string {
  const markers: string[] = [];

  // Negritas: **texto** → \textbf{texto}
  text = text.replace(/\*\*(.+?)\*\*/g, (_match: string, inner: string) => {
    const idx = markers.length;
    markers.push(`\\textbf{${escapeLatex(inner)}}`);
    return `\x00MD${idx}\x00`;
  });

  // Cursivas: *texto* → \textit{texto}
  text = text.replace(/\*(.+?)\*/g, (_match: string, inner: string) => {
    const idx = markers.length;
    markers.push(`\\textit{${escapeLatex(inner)}}`);
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
 * Escapa caracteres especiales de LaTeX para que el contenido
 * se renderice como texto literal dentro de `\dictum{…}`.
 */
function escapeLatex(text: string): string {
  return text
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/{/g, "\\{")
    .replace(/}/g, "\\}")
    .replace(/\$/g, "\\$")
    .replace(/&/g, "\\&")
    .replace(/#/g, "\\#")
    .replace(/\^/g, "\\textasciicircum{}")
    .replace(/_/g, "\\_")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/%/g, "\\%");
}

/**
 * Convierte el contenido de un fenced div .dictum a LaTeX.
 */
function renderDictum(content: string): {
  latex: string;
} {
  // Dividir por dobles saltos de linea (parrafos)
  const paragraphs = content
    .trim()
    .split(/\n{2,}/)
    .map((p) => p.replace(/\n+/g, " ").trim())
    .filter(Boolean);

  if (paragraphs.length === 0) return { latex: "" };

  // Ultimo parrafo = autor, resto = cita
  const quoteRaw = paragraphs.slice(0, -1).join("\n\n");
  const authorRaw =
    paragraphs.length > 1
      ? (paragraphs[paragraphs.length - 1] ?? "")
      : undefined;

  const quote = renderMarkdownInline(quoteRaw);

  if (authorRaw) {
    const author = renderMarkdownInline(authorRaw);
    return { latex: `\\dictum[${author}]{${quote}}` };
  }

  return { latex: `\\dictum{${quote}}` };
}

const plugin: IPlugin = {
  name: "dictum-plugin",

  beforeExport(context) {
    const body = context.body;
    const matches: DictumMatch[] = [];

    // Primera pasada: recolectar todos los matches con matchAll
    // (escanea todo el string, a diferencia de exec con lastIndex)
    for (const m of body.matchAll(DICTUM_RE)) {
      matches.push({
        index: m.index,
        length: m[0].length,
        content: m[1],
      });
    }

    if (matches.length === 0) return context;

    // Segunda pasada: determinar si cada dictum es seguido de otro dictum
    // (reemplazo de derecha a izquierda para no alterar índices)
    let result = body;
    for (let i = matches.length - 1; i >= 0; i--) {
      const m = matches[i];
      const rendered = renderDictum(m.content);
      if (!rendered.latex) {
        result = result.slice(0, m.index) + result.slice(m.index + m.length);
        continue;
      }

      // Determinar si este dictum es seguido inmediatamente por otro
      // (solo espacios/blank lines entre el cierre y la siguiente apertura)
      const next = matches[i + 1];
      let isConsecutive = false;
      if (next) {
        const gapStart = m.index + m.length;
        const gapEnd = next.index;
        const gap = body.slice(gapStart, gapEnd);
        if (CONSECUTIVE_GAP_RE.test(gap)) {
          isConsecutive = true;
        }
      }

      // Determinar si es el ultimo de una cadena consecutiva
      // (el anterior es consecutivo pero no hay siguiente, o el siguiente no lo es)
      let isChainEnd = false;
      if (!isConsecutive) {
        const prev = matches[i - 1];
        if (prev) {
          const prevGapStart = prev.index + prev.length;
          const prevGapEnd = m.index;
          const prevGap = body.slice(prevGapStart, prevGapEnd);
          if (CONSECUTIVE_GAP_RE.test(prevGap)) {
            isChainEnd = true;
          }
        }
      }

      const spacing = isConsecutive
        ? "2\\topskip"
        : isChainEnd
          ? "2.9\\topskip"
          : "3.4\\topskip";
      const prefix = `\\renewcommand*{\\dictumauthorformat}[1]{#1\\vspace*{${spacing}}}`;
      const latex = `${prefix}\n${rendered.latex}`;

      let endIndex = m.index + m.length;
      if (!isConsecutive) {
        // Consumir las líneas en blanco después del cierre :::
        // y añadir \noindent para que el párrafo siguiente no tenga indentación.
        const after = result.slice(endIndex);
        const blankMatch = /^\n+/.exec(after);
        if (blankMatch) {
          endIndex += blankMatch[0].length;
          result =
            result.slice(0, m.index) +
            `${latex}\n\\noindent\\ignorespaces ` +
            result.slice(endIndex);
        } else {
          result = result.slice(0, m.index) + latex + result.slice(endIndex);
        }
      } else {
        result = result.slice(0, m.index) + latex + result.slice(endIndex);
      }
    }

    return { ...context, body: result };
  },
};

export default plugin;
