# language: es
Característica: El validador marca las colones sueltas del cuerpo
  Como quien escribe un documento
  Quiero que el build me avise de una ":" que se quedó sola en su línea
  Para no publicar una valla mal cerrada

  # #2492 — la valla de un div admite tres o más colones. Cuatro es la forma de
  # anidar y es la que usa el builder para las tarjetas de miembro, así que ni
  # cuatro ni tres son una ":" suelta cuando forman un div.
  Escenario: Una línea con un solo dos puntos se reporta
    Dado un cuerpo:
      """
      texto

      :

      texto
      """
    Entonces las líneas reportadas son "[3]"

  Escenario: Varios dos puntos sueltos se reportan todos
    Dado un cuerpo:
      """
      :

      texto

      :::

      ::::
      """
    Entonces las líneas reportadas son "[1, 5, 7]"

  Escenario: Un div anidado de cuatro y tres colones no se reporta
    Dado un cuerpo:
      """
      Antes.

      :::: {.nota}

      ::: {.advertencia}

      Texto dentro.

      :::

      ::::

      Después.
      """
    Entonces las líneas reportadas son "[]"

  Escenario: La apertura y el cierre de un div de cuatro colones no se reportan
    Dado un cuerpo:
      """
      :::: {.nota}

      Texto.

      ::::
      """
    Entonces las líneas reportadas son "[]"

  Escenario: Una valla más larga que la apertura no se reporta
    Dado un cuerpo:
      """
      ::: {.nota}

      Texto.

      ::::
      """
    Entonces las líneas reportadas son "[]"

  Escenario: La valla suelta dentro de un div de cuatro colones sí se reporta
    Dado un cuerpo:
      """
      :::: {.nota}

      :::

      """
    Entonces las líneas reportadas son "[3]"

  Escenario: Una valla suelta sin nada abierto sí se reporta
    Dado un cuerpo:
      """
      texto

      ::::
      """
    Entonces las líneas reportadas son "[3]"

  Escenario: El espaciador de dos puntos y el cierre sin indentación no se reportan
    Dado un cuerpo:
      """
      texto

      ::

      texto

      :;

      texto
      """
    Entonces las líneas reportadas son "[]"

  Escenario: El dos puntos con espacio final no se reporta si es el espaciador
    Dado un cuerpo:
      """
      texto

      ::

      texto

      :; 

      texto
      """
    Entonces las líneas reportadas son "[]"

  Escenario: El dos puntos solo con espacio final sí se reporta
    Dado un cuerpo:
      """
      texto

      : 

      texto
      """
    Entonces las líneas reportadas son "[3]"