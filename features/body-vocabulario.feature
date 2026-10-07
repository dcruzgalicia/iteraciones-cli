# language: es
Característica: la `:` suelta en el cuerpo del documento

  Como quien escribe markdown en un editor
  Quiero que una `:` suelta me avise con su número de línea
  Para no buscarla durante media hora en un documento de trescientas líneas

  Regla de negocio: Una `:` sola en su línea es un error

    Escenario: Una línea con `:` y nada más
      Dado que el cuerpo del documento es:
      """
      texto<br><br>:<br><br>texto
      """
      Cuando busco las colones sueltas
      Entonces las colones sueltas están en las líneas "3"

    Esquema del escenario: Una valla suelta, de uno o varios colones
      Dado que el cuerpo del documento es:
      """
      <cuerpo>
      """
      Cuando busco las colones sueltas
      Entonces las colones sueltas están en las líneas "<lineas>"

      Ejemplos:
        | cuerpo | lineas |
        | :<br><br>texto<br><br>:::<br><br>:::: | 1, 5, 7 |

    Escenario: Una `:` con un espacio final sigue siendo suelta
      Dado que el cuerpo del documento es:
      """
      texto<br><br>: <br><br>texto
      """
      Cuando busco las colones sueltas
      Entonces las colones sueltas están en las líneas "3"

    Escenario: Una `:::` sin div abierto se marca igual
      Dado que el cuerpo del documento es:
      """
      :::<br><br>:::
      """
      Cuando busco las colones sueltas
      Entonces las colones sueltas están en las líneas "1, 3"

    Escenario: El aviso cuenta las líneas del frontmatter
      Dado que el cuerpo del documento es:
      """
      texto<br><br>:<br><br>texto
      """
      Y que el frontmatter ocupa 3 líneas
      Cuando busco las colones sueltas
      Entonces las colones sueltas están en las líneas "6"

  Regla de negocio: La apertura y el cierre de un div son fences, no colones sueltas

    Esquema del escenario: Las fences de un div no son colones sueltas
      Dado que el cuerpo del documento es:
      """
      <cuerpo>
      """
      Cuando busco las colones sueltas
      Entonces no hay colones sueltas

      Ejemplos:
        | cuerpo |
        | ::: {.nota}<br><br>Texto.<br><br>:::: |
        | ::: {.dictum}<br>Cita de prueba<br>::: |
        | ::: {.a}<br>::: {.b}<br>contenido<br>:::<br>::: |

    Esquema del escenario: El espaciador y la línea sin indentación no se marcan
      Dado que el cuerpo del documento es:
      """
      <cuerpo>
      """
      Cuando busco las colones sueltas
      Entonces no hay colones sueltas

      Ejemplos:
        | cuerpo |
        | texto<br><br>::<br><br>texto |
        | texto<br><br>:;<br><br>texto |
        | texto<br><br>:: <br><br>texto |
        | texto<br><br>:; <br><br>texto |

    Esquema del escenario: Una línea con texto no es una `:` suelta
      Dado que el cuerpo del documento es:
      """
      <cuerpo>
      """
      Cuando busco las colones sueltas
      Entonces no hay colones sueltas

      Ejemplos:
        | cuerpo |
        | Reunión a las 12:30 |
        | https://ejemplo.com/nota |
        | :smile: |
        | :: con texto |
        | :; y texto |

  Regla de negocio: Los bloques de código no se buscan

    Esquema del escenario: Un bloque de código entero se ignora
      Dado que el cuerpo del documento es:
      """
      <cuerpo>
      """
      Cuando busco las colones sueltas
      Entonces no hay colones sueltas

      Ejemplos:
        | cuerpo |
        | ```<br>:<br>::<br>:::<br>``` |
        | ~~~<br>:<br>~~~ |
        | ```lua<br>::: {.dictum}<br>``` |
        | ::: {.centered}<br>```<br>:<br>```<br>::: |

    Escenario: El conteo sigue bien tras un bloque de código
      Dado que el cuerpo del documento es:
      """
      a<br>```<br>:<br>```<br>b<br><br>:<br>
      """
      Cuando busco las colones sueltas
      Entonces las colones sueltas están en las líneas "7"

  Regla de negocio: El aviso nombra las dos formas correctas

    Escenario: Una línea, en singular
      Dado que el cuerpo del documento es:
      """
      texto<br><br>:<br><br>texto
      """
      Cuando busco las colones sueltas
      Y armo el aviso de las colones sueltas
      Entonces el aviso de colones dice "línea 3 con \":\" suelta: ¿querías escribir \"::\" (espacio vertical) o \":;\" (sin indentación)?"

    Escenario: Varias líneas, en plural y en lista
      Dado que el cuerpo del documento es:
      """
      texto<br><br>:<br><br>texto<br><br>:<br><br>:<br><br>texto
      """
      Cuando busco las colones sueltas
      Y armo el aviso de las colones sueltas
      Entonces el aviso de colones dice "líneas 3, 7, 9 con \":\" suelta: ¿querías escribir \"::\" (espacio vertical) o \":;\" (sin indentación)?"
