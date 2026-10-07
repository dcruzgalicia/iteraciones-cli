# language: es
Característica: el fragmento que muestra la tarjeta de un miembro

  Como quien tiene una colección de cuarenta documentos
  Quiero ver el primer párrafo de cada uno en su tarjeta
  Para saber qué hay sin abrir cuarenta archivos

  # Tramo 9 de la migración. 13 de los 27 casos de `collection-fragment.test.ts`.

  Regla de negocio: El fragmento es el primer párrafo, y lo que no es texto se salta

    # En una tarjeta caben unas pocas líneas. Lo que va antes del primer
    # párrafo —encabezados, bloques de código, listas, citas— es andamiaje del
    # documento, no su contenido, y como fragmento no le dice nada al lector.

    Esquema del escenario: El fragmento es el primer párrafo de verdad
      Dado que el documento tiene el cuerpo:
      """
      <cuerpo>
      """
      Cuando extraigo su fragmento
      Entonces el fragmento es "<esperado>"

      Ejemplos:
        | cuerpo | esperado |
        | Una frase corta.<br><br>Y otra que no entra. | Una frase corta. |
        | # Título<br><br>## Subtítulo<br><br>El párrafo de verdad. | El párrafo de verdad. |
        | Título del documento<br>=====================<br><br>Tras el título. | Tras el título. |
        | ```js<br>codigo();<br>```<br><br>Tras el código. | Tras el código. |
        | - uno<br>- dos<br><br>Tras la lista. | Tras la lista. |
        | > una cita<br><br>Tras la cita. | Tras la cita. |

    # Un documento que sólo tiene código no tiene nada que mostrar en su
    # tarjeta. Es preferible una tarjeta con el enlace y sin texto que un
    # bloque de código que el lector no pidió.
    Esquema del escenario: Un cuerpo sin texto que mostrar no da fragmento
      Dado que el documento tiene el cuerpo:
      """
      <cuerpo>
      """
      Cuando extraigo su fragmento
      Entonces el fragmento está vacío

      Ejemplos:
        | cuerpo |
        | ```text<br>solo código<br>``` |
        | <br><br># Solo un título<br><br> |

    Escenario: Sin cuerpo no hay fragmento
      Dado que el documento tiene el cuerpo:
      """
      """
      Cuando extraigo su fragmento
      Entonces el fragmento está vacío

  Regla de negocio: Un bloque `:::` se muestra completo

    # El bloque `::: {.nota}` es contenido del autor, no andamiaje. Recortarlo
    # por dentro lo deja mal cerrado y el HTML final se come el cierre.

    Escenario: Un bloque corto sale entero, con sus líneas de fence
      Dado que el documento tiene el cuerpo:
      """
      ::: {.nota}
      Contenido corto de la nota.
      :::

      Después del div.
      """
      Cuando extraigo su fragmento
      Entonces el fragmento es:
      """
      ::: {.nota}
      Contenido corto de la nota.
      :::
      """

    # El corte por dentro del bloque pone los puntos ANTES del cierre, o el
    # fragmento deja un `:::` sin cerrar y el HTML se desarma.
    Escenario: Un bloque largo se recorta por dentro y se cierra él mismo
      Dado que el cuerpo es un bloque de 150 palabras
      Cuando extraigo su fragmento
      Entonces el fragmento cierra el bloque él mismo
      Y los puntos suspensivos van antes del cierre del bloque
      Y el fragmento tiene 100 palabras en su línea de contenido

    Escenario: Un bloque sin cerrar se cierra en el fragmento
      Dado que el documento tiene el cuerpo:
      """
      ::: {.nota}
      Contenido sin cierre.
      """
      Cuando extraigo su fragmento
      # El autor dejó el `:::` sin poner. El fragmento lo cierra igual, o la
      # tarjeta se come el resto de la página.
      Entonces el fragmento es:
      """
      ::: {.nota}
      Contenido sin cierre.
      :::
      """

  Regla de negocio: El recorte no parte un enlace

    # Si el corte cae en medio de `[texto](./destino.html)`, la tarjeta muestra
    # un corchete suelto y un enlace roto. El corte retrocede hasta el token
    # anterior al `[`.

    Escenario: Un párrafo largo se corta y se marca
      Dado que el cuerpo es un párrafo con 150 palabras
      Cuando extraigo su fragmento
      Entonces el fragmento se corta con puntos suspensivos
      Y el fragmento tiene 101 palabras

    Escenario: El corte no parte un enlace
      Dado que el cuerpo es 99 palabras y un enlace
      Cuando extraigo su fragmento
      Entonces el fragmento se corta con puntos suspensivos
      Y el fragmento no dice "["
      Y el fragmento tiene 100 palabras