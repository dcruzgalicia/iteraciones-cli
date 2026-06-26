import type { IPlugin } from "../../src/plugin/types.js";

/**
 * Plugin built-in `dictum-plugin` para iteraciones-cli.
 *
 * Actualmente no realiza transformaciones en beforeExport.
 * La transformación de fenced divs `.dictum` a comandos LaTeX
 * \dictum[author]{quote} se realiza mediante el filtro Lua
 * `pandoc/filters/dictum.lua` que se ejecuta DESPUÉS de que
 * pandoc-citeproc procese las citas, garantizando que @citekey
 * se resuelva correctamente.
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

const plugin: IPlugin = {
  name: "dictum-plugin",

  beforeExport(context) {
    // La transformación ahora se delega al filtro Lua pandoc/filters/dictum.lua
    // que corre DESPUÉS de citeproc, permitiendo que @citekey se procese.
    return context;
  },
};

export default plugin;
