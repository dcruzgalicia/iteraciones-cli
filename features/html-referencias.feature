# language: es
Característica: la tarjeta de referencias se sostiene sola

  Como quien tiene citas en su texto
  Quiero que las referencias aparezcan en su propia tarjeta, con su título
  Para que se entienda qué es una cita y qué es la bibliografía

  # Tramo 3 de la migración. 5 de los 16 casos que quedaban de `cli-layer`.

  Regla de negocio: La tarjeta de referencias

    # El heading de la tarjeta lo pone el post-procesador, con el id
    # `refs-heading`. Si el autor ya escribió su propio heading `# Referencias
    # {#referencias}`, ese se conserva en el cuerpo y no se duplica el id. Si
    # una cita no tiene entrada en el `.bib`, no queda una tarjeta vacía: se va
    # el heading entero, porque un hueco visible se nota más que su ausencia.

    Escenario: Un heading Referencias propio se conserva cuando no hay citas
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Dado que el archivo "test.md" tiene este contenido
      """
      ---
      title: Test Document
      date: 2026-01-01
      ---

      Texto.

      # Referencias {#referencias}

      Manual.
      """
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y un heading Referencias propio sobrevive cuando no hay citas

    Escenario: Un heading Referencias propio se conserva aunque haya citas
      Dado que la raíz del proyecto tiene un proyecto con una cita
      Dado que el archivo "test.md" tiene este contenido
      """
      ---
      title: Test Document
      date: 2026-01-01
      ---

      Cita [@key1].

      # Referencias {#referencias}

      Manual.
      """
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el heading propio y la tarjeta de referencias no se pisan

    Escenario: El heading de la tarjeta va antes que el bloque de entradas
      Dado que la raíz del proyecto tiene un proyecto con una cita
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el heading de la tarjeta va antes que sus entradas

    Escenario: Una cita sin entrada en el .bib no deja la tarjeta huérfana
      Dado que la raíz del proyecto tiene un proyecto con una cita
      Dado que el archivo "test.md" tiene este contenido
      """
      ---
      title: Test Document
      date: 2026-01-01
      ---

      # Sección

      Cita rota [@key-inexistente].
      """
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y una cita sin entrada deja el documento sin tarjeta de referencias

    Escenario: El índice no enlaza a referencias pero la tarjeta conserva su chip
      Dado que la raíz del proyecto tiene un proyecto con índice y una cita
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el índice no ofrece referencias pero la tarjeta las conserva
