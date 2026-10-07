# language: es
Característica: el frontmatter del documento

  Como quien escribe un documento en markdown
  Quiero que mi bloque `---` se separe del cuerpo y que un YAML roto me diga
  dónde está
  Para no tener que buscar el error a mano en un archivo de trescientas líneas

  # Tramo 7 de la migración. Los 17 casos restantes de `discover.test.ts`.

  Regla de negocio: El YAML se separa del cuerpo y el cuerpo conserva su salto

    # El `body` vuelve con el `\n` que separa el cierre del YAML. No es un
    # detalle: si el cuerpo volviera limpio, el primer párrafo pegaría al
    # preámbulo y el PDF saldría con la sangría corrida. Los `Examples` llevan
    # el salto a propósito.

    Esquema del escenario: El archivo se parte en YAML y cuerpo
      Dado que el archivo tiene este texto:
      """
      <contenido>
      """
      Cuando separo el frontmatter del cuerpo
      Entonces el YAML separado es "<yaml>"
      Y el cuerpo separado es "<cuerpo>"

      Ejemplos:
        | contenido | yaml | cuerpo |
        | ---<br>title: Prueba<br>---<br><br>Contenido | title: Prueba | <br>Contenido |
        | Contenido sin frontmatter | sin YAML | Contenido sin frontmatter |
        | ---<br>title: Fin<br>--- | title: Fin | |
        | ---<br>title: Prueba<br>---<br><br>---<br>no es frontmatter<br>--- | title: Prueba | <br>---<br>no es frontmatter<br>--- |

    # El `---` del medio del archivo es una regla horizontal de markdown, no
    # un frontmatter. Confundirlos separa el YAML donde no toca y deja el cuerpo
    # con las comillas colgando.
    Escenario: Un `---` interno no es frontmatter
      Dado que el archivo tiene este texto:
      """
      ---
      title: Prueba
      ---

      ---
      no es frontmatter
      ---
      """
      Cuando separo el frontmatter del cuerpo
      Entonces el YAML separado es "title: Prueba"
      Y el cuerpo separado es:
      """
      <br>---
      no es frontmatter
      ---
      """

    # Un archivo editado en Windows trae CRLF. Si la separación buscase sólo
    # `\n`, el YAML se llevaría una línea en blanco de más y el título vacío.
    Escenario: Un archivo con CRLF se separa igual
      Dado que el archivo tiene saltos CRLF y este texto:
      """
      ---\r\ntitle: Prueba\r\n---\r\n\r\nContenido
      """
      Cuando separo el frontmatter del cuerpo
      Entonces el YAML separado es "title: Prueba"
      Y el cuerpo separado es:
      """
      \r\nContenido
      """

  Regla de negocio: Un YAML roto se reporta en una línea, con dónde

    # El logger del CLI imprime cada error dentro de una línea de bullet: lo
    # que no quepa se corta. La librería de YAML trae su snippet con caret en
    # varias líneas, y eso hay que quitarlo antes de que llegue al mensaje.

    Escenario: La causa y la posición van en una sola línea
      Dado que el archivo tiene este texto:
      """
      lang: [unclosed
      """
      Cuando parseo el YAML con posición
      Entonces el YAML no se parsea
      Y el error del YAML cabe en una sola línea

    Escenario: Un YAML válido se parsea
      Dado que el archivo tiene este texto:
      """
      lang: es-MX
      toc: true
      """
      Cuando parseo el YAML con posición
      Entonces el error del YAML no está
      Y el YAML se parsea a:
      """
      {"lang":"es-MX","toc":true}
      """

    # Las causas que el autor se va a encontrar translated al español. El
    # mensaje de la librería es para quien escribe el parser, no para quien
    # escribe el documento.
    Esquema del escenario: Las causas conocidas llegan en español
      Dado que el archivo tiene este texto:
      """
      <yaml>
      """
      Cuando parseo el YAML con posición
      Entonces el error del YAML dice "<causa>"

      Ejemplos:
        | yaml | causa |
        | title: A<br>title: B | las claves del mapeo deben ser únicas |
        | title: [roto | la secuencia de flujo debe estar bien indentada |
        | title: "sin cerrar | falta la comilla de cierre |

    # #2178: el error más frecuente de un escritor no es una llave mal cerrada
    # sino una indentación que se rompió por un tabulador. Son estas cuatro.
    Esquema del escenario: Las indentaciones rotas se explican
      Dado que el archivo tiene este texto:
      """
      <yaml>
      """
      Cuando parseo el YAML con posición
      Entonces el error del YAML dice "<causa>"

      Ejemplos:
        | yaml | causa |
        | title: Test<br>foo<br>  bar: 1 | clave de mapeo inesperada |
        | - a<br>b: 1 | contenido inesperado |
        | a: 1<br>  b: 2 | no se admiten mapeos anidados |

    # La posición tiene que señalar la línea donde empieza el error, no donde
    # terminó de leer la librería.
    Escenario: La posición es la de la clave que rompió la estructura
      Dado que el archivo tiene este texto:
      """
      title: Test
      foo
        bar: 1
      """
      Cuando parseo el YAML con posición
      Entonces el error del YAML dice "(línea 2, columna 1)"