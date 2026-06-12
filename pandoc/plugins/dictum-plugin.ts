import type { IPlugin } from "../../src/plugin/types.js";

/**
 * Plugin built-in `dictum-plugin` para iteraciones-cli.
 *
 * Transforma fenced divs con clase `.dictum` en el comando LaTeX
 * `\dictum[author]{quote}` durante la exportación PDF, aprovechando
 * la configuración KOMA-Script ya presente en las plantillas LaTeX
 * del proyecto.
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

const plugin: IPlugin = {
  name: "dictum-plugin",

  beforeExport(context) {
    const body = context.body.replace(
      DICTUM_RE,
      (_match: string, content: string) => {
        const lines = content
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l.length > 0);

        if (lines.length === 0) return "";

        // La última línea no vacía se considera el autor;
        // el resto se concatena como la cita.
        const quoteRaw = lines.slice(0, -1).join(" ");
        const authorRaw =
          lines.length > 1 ? (lines[lines.length - 1] ?? "") : undefined;

        const quote = escapeLatex(quoteRaw);

        if (authorRaw) {
          const author = escapeLatex(authorRaw);
          return `\\dictum[${author}]{${quote}}`;
        }

        return `\\dictum{${quote}}`;
      },
    );

    return { ...context, body };
  },
};

export default plugin;
