# language: es
Característica: la `:` suelta en el cuerpo del documento

  Como quien escribe markdown en un editor
  Quiero que una `:` suelta me avise con su número de línea
  Para no buscarla durante media hora en un documento de trescientas líneas

  # Tramo 19 de la migración. Los 20 casos de `body-vocabulary.test.ts`.

  # Todo lo que se parece a una `:` suelta y no lo es: `::` (espaciador), `:;`
  # (sin indentación), `12:30` (una hora), `https://...`, `:smile:` (un emoji),
  # `::: {.nota}` (la valla de un div) y todo lo que va dentro de un bloque de
  # código. Cada "no" protege a un autor que escribió algo legal.
  #
  # El conteo cuenta líneas de ARCHIVO, no del cuerpo: el mensaje dice "línea
  # 6" y el autor abre el archivo a la línea 6. Por eso el offset del
  # frontmatter se suma.

  Regla de negocio: Una `:` sola en su línea es un error

    Escenario: Una línea con `:` y nada más
      Dado que el cuerpo del documento es:
      """
      texto<br><br>:<br><br>texto
      """
      Cuando busco las colones sueltas
      Entonces las colones sueltas están en las líneas "3"

    # Tres, cuatro o más colones: uno o varios. Con cuatro es la forma de
    # anidar, y con tres la valla más común.
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

    # Una `:` con espacio al final es la `:` suelta: el espacio es ignorable.
    Escenario: Una `:` con un espacio final sigue siendo suelta
      Dado que el cuerpo del documento es:
      """
      texto<br><br>: <br><br>texto
      """
      Cuando busco las colones sueltas
      # El editor lo escribió con un espacio de más; el markdown no lo perdona.
      Entonces las colones sueltas están en las líneas "3"

    # Sin abrir, `:::` es texto literal para pandoc — y sale en el PDF como
    # texto, que es justo el problema que el aviso previene.
    Escenario: Una `:::` sin div abierto se marca igual
      Dado que el cuerpo del documento es:
      """
      :::<br><br>:::
      """
      Cuando busco las colones sueltas
      # Pandoc lo trata como texto literal, así que el autor vería `:::` en el
      # PDF y no sabría por qué.
      Entonces las colones sueltas están en las líneas "1, 3"

    # El aviso tiene que señalar la línea del ARCHIVO, no la del cuerpo.
    Escenario: El aviso cuenta las líneas del frontmatter
      Dado que el cuerpo del documento es:
      """
      texto<br><br>:<br><br>texto
      """
      Y que el frontmatter ocupa 3 líneas
      Cuando busco las colones sueltas
      # Sin el offset el aviso apuntaría a la línea 3 del archivo, que es la
      # segunda del frontmatter.
      Entonces las colones sueltas están en las líneas "6"

  Regla de negocio: La apertura y el cierre de un div son fences, no colones sueltas

    # #2492. Cuatro colones es la forma de anidar y la que usa el builder para
    # las tarjetas de miembro: marcarlas rompería un documento válido.
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

    # El espaciador y la línea sin indentación son sintaxis válida de pandoc.
    # Marcarlas sería decirle al autor que su vertical está mal.
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

    # Una línea con `:` y algo más no es una `:` suelta. Aquí un falso positivo
    # le diría al autor que su hora está mal puesta.
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

    # Una `:` dentro de código es código. Marcarla obligaría al autor a
    # reescribir un fragmento de lua para callar a un validador.
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

    # Ignorar el bloque no puede desalinear el conteo: el aviso sigue teniendo
    # la línea del archivo.
    Escenario: El conteo sigue bien tras un bloque de código
      Dado que el cuerpo del documento es:
      """
      a<br>```<br>:<br>```<br>b<br><br>:<br>
      """
      Cuando busco las colones sueltas
      # El bloque ocupa tres líneas que no se buscan, pero sí se cuentan.
      Entonces las colones sueltas están en las líneas "7"

  Regla de negocio: El aviso nombra las dos formas correctas

    Escenario: Una línea, en singular
      Dado que el cuerpo del documento es:
      """
      texto<br><br>:<br><br>texto
      """
      Cuando busco las colones sueltas
      Y armo el aviso de las colones sueltas
      # El aviso dice qué escribir, no sólo qué está mal.
      Entonces el aviso de colones dice "línea 3 con \":\" suelta: ¿querías escribir \"::\" (espacio vertical) o \":;\" (sin indentación)?"

    Escenario: Varias líneas, en plural y en lista
      Dado que el cuerpo del documento es:
      """
      texto<br><br>:<br><br>texto<br><br>:<br><br>:<br><br>texto
      """
      Cuando busco las colones sueltas
      Y armo el aviso de las colones sueltas
      # En plural porque son varias, y con los números para poder ir a cada una.
      Entonces el aviso de colones dice "líneas 3, 7, 9 con \":\" suelta: ¿querías escribir \"::\" (espacio vertical) o \":;\" (sin indentación)?"
