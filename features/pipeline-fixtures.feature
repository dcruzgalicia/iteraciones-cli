# language: es
@requires-pandoc
Característica: el pipeline avisa a quien lo embedda

  Como quien mete `build()` en otro programa en vez de usar el CLI
  Quiero que el reporter reciba las fases y los totales que documenta la API
  Para poder dibujar mi propia barra de progreso sin adivinar nada

  @spy-pipeline
  Regla de negocio: El reporter recibe el ciclo completo
    Escenario: build() con un reporter propio recorre discovery → render → cierre
      Dado un proyecto con LaTeX, EPUB y Markdown activados y HTML desactivado
      Cuando compilo el proyecto con un reporter que cuenta eventos
      Entonces el reporter recibe setFormats, planPhases y finish, y ninguna fase de fallo
      Y el reporter recibe las fases de discovery y de render
      Y el reporter declara el render con el total de documentos
      Y el reporter cierra con un documento procesado y ninguno en caché

  @spy-pipeline
  Regla de negocio: La versión de pandoc se sondea una vez, no una por documento

    Escenario: pandoc se consulta una sola vez por build
      Dado un proyecto con LaTeX, EPUB y Markdown activados y HTML desactivado
      Cuando compilo el proyecto con un reporter que cuenta eventos
      Entonces pandoc se consulta una sola vez por build
