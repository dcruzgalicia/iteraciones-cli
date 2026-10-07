# language: es
Característica: las tarjetas del masonry salen en el orden que el autor espera

  Como quien lee el resultado en el navegador
  Quiero que las tarjetas salgan en un orden predecible
  Para que la portada, el índice, la descarga, el contenido y las referencias
  formen una página que se pueda recorrer sin adivinar

  Regla de negocio: El orden de las tarjetas

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
