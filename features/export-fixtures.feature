# language: es
Característica: Los exportadores respetan el contrato de pandoc
  Como quien produce un EPUB o un Markdown desde el CLI
  Quiero que pandoc se invoque con los argumentos correctos
  Para que el formato de salida sea el que el proyecto pidió

  # #2031 PR2 — el contrato de argumentos se verifica SIN invocar el binario:
  # `execPandoc` está espiado y se capturan sus opciones. Los smokes reales de
  # EPUB y Markdown quedan en `export-runner.test.ts`.
  #
  # Este feature es denso en aserciones a propósito: cada paso afirma un
  # comportamiento (el formato, el índice, los metadatos), no un `expect`. El
  # escenario que de verdad calibra el catálogo es `lua-filters` (84 casos).

  Antecedentes:
    Dado un proyecto de prueba
    Y un documento titulado "Mi título" de la autora "Autora Uno"

  @spy-pandoc
  Escenario: El EPUB sale en epub3 con los metadatos y el índice
    Cuando convierto el documento a EPUB con índice
    Entonces pandoc recibe una llamada que escribe en el archivo de salida
    Y pandoc escribe en "epub3" leyendo del markdown del proyecto
    Y pandoc recibe el índice y los metadatos del documento

  @spy-pandoc
  Escenario: Sin índice no va --toc, y citeproc sólo con bibliografía
    Cuando convierto el documento a EPUB sin índice
    Y lo convierto de nuevo con bibliografía "/abs/refs.bib"
    Entonces pandoc recibe dos llamadas
    Y la primera no lleva ni índice ni citeproc
    Y la segunda lleva citeproc

  @spy-pandoc
  Escenario: El Markdown no pasa por pandoc (#2436)
    Cuando convierto el documento a Markdown con índice y bibliografía local
    Entonces pandoc no recibe ninguna llamada
    Y el Markdown sale con el frontmatter del documento y sin rutas absolutas