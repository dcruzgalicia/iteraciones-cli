import type { IPlugin } from "../../src/plugin/types.js";

/**
 * Plugin built-in `dictum-plugin` para iteraciones-cli.
 *
 * La transformacion de fenced divs `.dictum` a comandos LaTeX
 * \\dictum[author]{quote} se realiza mediante el transpiler
 * `transpilers/02-dictum.ts` que opera sobre el JSON AST de pandoc
 * antes de la conversion a LaTeX.
 *
 * ## Uso en Markdown
 *
 * ```markdown
 * ::: {.dictum}
 * Dios hizo los numeros enteros, el resto es obra del hombre.
 *
 * Leopold Kronecker
 * :::
 * ```
 *
 * La ultima linea se usa como autor (argumento opcional de `\\dictum`).
 * Si solo hay una linea, se omite el autor.
 */

const plugin: IPlugin = {
  name: "dictum-plugin",

  beforeExport(context) {
    // La transformacion de fenced divs .dictum se realiza en transpilers/02-dictum.ts
    return context;
  },
};

export default plugin;
