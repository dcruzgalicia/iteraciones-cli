# language: es
@requires-pandoc
Característica: Los filtros Lua del proyecto definen el contrato del markdown
  Como quien escribe un documento y espera que el build lo convierta
  Quiero saber exactamente qué produce cada construcción
  Para poder confiar en que el markdown de entrada llega como escribo

  # Todos los escenarios invocan **pandoc real**: no hay fixtures ni espías. Por
  # eso el feature va detrás de `@requires-pandoc` y el informe de omitidos dice
  # cuántos escenarios no corrieron en una máquina sin pandoc.
  #
  # Los datos de cada caso viven en `features/fixtures/lua-filters/<caso>.json`
  # en vez de en una tabla `Examples`: el markdown de entrada tiene saltos de
  # línea y las expectativas son cadenas de LaTeX con barras invertidas, y una
  # celda de tabla con eso dentro es ilegible (#2545). El nombre del caso es lo
  # único que va en la tabla, que es justo lo que se puede leer de un vistazo.
  Regla de negocio: Filtros Lua de LaTeX
    El markdown entra por el lector estándar de pandoc salvo que el caso pida `markdown+mark`.

    Esquema del escenario: Los filtros de LaTeX hacen lo que el markdown pide
      Dado el caso "<caso>"
      Cuando lo convierto a LaTeX
      Entonces cumple las expectativas guardadas

      Ejemplos:
        | caso |
        | convierte-en-vspace-baselineskip |
        | texto-uppercase-makeuppercase-texto-latex |
        | decoracion-inline-versalitas-mayusculas-subrayado-resaltado- |
        | mbox-envuelve-fuera-del-span-uppercase-makeuppercase-no-pene |
        | mbox-cuenta-las-palabras-de-resaltado-mark-como-grupo |
        | convierte-dentro-de-una-lista-en-vspace-antes-se-imprimia-li |
        | convierte-dentro-de-un-blockquote-en-vspace-antes-desapareci |
        | convierte-en-vspace-noindent-al-parrafo-siguiente |
        | convierte-div-dictum-sin-autor |
        | convierte-div-dictum-con-autor |
        | dictum-con-autor-enlazado-conserva-el-autor-antes-desapareci |
        | dictum-con-autor-entre-comillas-tipograficas-conserva-el-aut |
        | dictum-con-autor-de-dos-parrafos-los-separa-con-espacio |
        | convierte-div-verse-sin-vspace-externo |
        | agrega-noindent-al-parrafo-posterior-a-un-blockquote |
        | no-agrega-noindent-si-el-quote-no-es-seguido-por-un-parrafo |
        | convierte-div-center-y-div-flushright |
        | mbox-sentence-end-solo-envuelve-las-ultimas-3-palabras-de-la |
        | mbox-sentence-end-con-enfasis-final-wrap-interno-dentro-del- |
        | mbox-sentence-end-con-enfasis-de-2-palabras-al-final-el-mbox |
        | mbox-sentence-end-con-enfasis-de-1-palabra-al-final-extiende |
        | mbox-sentence-end-con-comillas-tipograficas-wrap-interno-den |
        | mbox-sentence-end-con-negritas-de-4-palabras-wrap-interno-de |
        | mbox-sentence-end-con-negritas-de-2-palabras-grupo-completo- |
        | mbox-sentence-end-con-negritas-de-1-palabra-extiende-hacia-a |
        | no-modifica-parrafos-de-menos-de-5-palabras |
        | no-corta-la-oracion-en-abreviaturas-de-meses-ni-en-p-ej |
        | detecta-el-punto-final-aunque-la-ultima-palabra-lleve-un-nbs |
        | convierte-japanese-al-entorno-cjk-con-encoding-min |
        | convierte-chinese-y-korean-con-sus-encodings-gbsn-ksc |
  Regla de negocio: Filtros Lua de HTML
    Cada Div con clase se envuelve en su elemento; el `::` se convierte en un div de altura fija.

    Esquema del escenario: Los filtros de HTML envuelven cada bloque con su clase
      Dado el caso "<caso>"
      Cuando lo convierto a HTML
      Entonces cumple las expectativas guardadas

      Ejemplos:
        | caso |
        | envuelve-div-dictum-en-blockquote-con-bloques-nativos |
        | envuelve-div-verse-en-div |
        | convierte-dentro-de-una-lista-a-div-spacer-nunca-literal |
        | envuelve-div-center-en-div |
        | envuelve-div-flushright-en-div |
        | convierte-div-spacer-en-div-vacio-con-los-filtros-semanticos |
        | no-altera-parrafos-normales |

  # Los 47 casos restantes de `lua-filters.test.ts` (los del AST en JSON, los de
  # `internal/flags`, los de usuario, `latex/07-titlepages` y
  # `semantic/ast/04-image-paths`) siguen en `bun test`: cada uno necesita su
  # propio contexto —template, bibliografía, proyecto temporal— y no se pueden
  # tabular. Se migran en un segundo commit de #2545.
