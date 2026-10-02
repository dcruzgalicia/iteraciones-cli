# language: es
Característica: El pipeline orquesta el ciclo completo sin invocar binarios
  Como quien prueba la orquestación del build
  Quiero ver el ciclo completo con pandoc espiado
  Para poder verificar la secuencia sin pagar un binario por corrida

  # #2031 PR3 — `build()` orquesta discovery → pipeline → cierre con
  # `execPandoc`/`getPandocVersion` espíados y un reporter falso contando
  # eventos. Sin tracker, sin latexmk y sin Tailwind (HTML desactivado ⇒
  # needsCss false).

  @spy-pipeline
  Escenario: build() con reporter falso y pandoc espiado completa el ciclo (#2031 PR3)
    Dado un proyecto con LaTeX, EPUB y Markdown activados y HTML desactivado
    Cuando compilo el proyecto con un reporter que cuenta eventos
    Entonces el build termina con éxito y sin fase de fallo
    Y el reporter recibe las fases de discovery y de render
    Y el reporter declara el render con el total de documentos
    Y el reporter cierra con un documento procesado y ninguno en caché
    Y pandoc se consulta una sola vez por build
    Y pandoc convierte exactamente a LaTeX y a EPUB
    Y el EPUB sale nombrado con el slug del documento
    Y dist tiene el .tex y el .md pero no el .epub
    Y el estado del proyecto queda completado
