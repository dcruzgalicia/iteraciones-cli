# language: es
Característica: las tarjetas del masonry salen en el orden que el autor espera

  Como quien lee el resultado en el navegador
  Quiero que las tarjetas salgan en un orden predecible
  Para que la portada, el índice, la descarga, el contenido y las referencias
  formen una página que se pueda recorrer sin adivinar

  # Tramo 3 de la migración. 4 de los 16 casos que quedaban de `cli-layer`.

  Regla de negocio: El orden de las tarjetas

    # El HTML se arma con un sistema de bloques. El orden por defecto es
    # header, título, índice, formatos, contenido, referencias, footer; una
    # lista explícita en `format.html.blocks` lo sustituye entero. Los bloques
    # que no aplican no aparecen: no hay huecos.
    #
    # El `article` es el CONTENIDO. Las otras tarjetas van antes o después de
    # él, nunca dentro: dentro, las columnas del masonry las reparten con el
    # texto y el documento deja de leerse como un bloque (#1445).

    Escenario: El masonry sigue el orden de bloques por defecto
      Dado que la raíz del proyecto tiene un proyecto con índice y una cita
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y las tarjetas del documento salen en el orden por defecto

    Escenario: Una lista explícita de bloques ES el orden
      Dado que la raíz del proyecto ordena los bloques así:
      """
      header
      contenido
      indice
      formatos
      referencias
      footer
      """
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y la lista explícita de bloques ES el orden

    Escenario: Sin índice, sin citas y sin formatos, los bloques ausentes no aparecen
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y los bloques que no aplican no dejan huecos

    Escenario: Las tarjetas de formatos y referencias quedan fuera de la de contenido
      Dado que la raíz del proyecto tiene un proyecto con índice y una cita
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y las tarjetas de formatos y referencias quedan fuera de la de contenido
