# language: es
@requires-pandoc
Característica: el pipeline avisa a quien lo embedda

  Como quien mete `build()` en otro programa en vez de usar el CLI
  Quiero que el reporter reciba las fases y los totales que documenta la API
  Para poder dibujar mi propia barra de progreso sin adivinar nada

  # `docs/public-surface.md` publica `build(options, reporter?)` y los eventos
  # de `BuildReporter` como superficie: cualquiera que embeba la librería depende
  # de ese contrato, así que no es un detalle interno.

  # Este feature antes espiaba `execPandoc` y devolvía fixtures enlatados: el
  # build "pasaba" sin que pandoc se ejecutara nunca, y cinco de sus ocho
  # aserciones miraban al espía y al reporter en vez de la salida. Cuatro de
  # esas cinco ya están cubiertas con pandoc de verdad en `build-completo.feature`
  # —qué formatos salen, cómo se nombran, qué hay en dist, qué queda en el
  # estado—, así que aquí sólo queda lo que no está en ningún otro lado: la
  # secuencia del reporter, y que no se le pregunte la versión a pandoc una vez
  # por documento.

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

    # Un build de cuarenta documentos no puede pagar cuarenta veces el
    # `pandoc --version`. El espía **deja pasar**: la versión real se consulta y
    # sólo se cuenta, así que lo que se comprueba es el gasto real, no un doble.

    Escenario: pandoc se consulta una sola vez por build
      Dado un proyecto con LaTeX, EPUB y Markdown activados y HTML desactivado
      Cuando compilo el proyecto con un reporter que cuenta eventos
      Entonces pandoc se consulta una sola vez por build
