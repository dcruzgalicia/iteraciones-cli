Característica: el fragmento que muestra la tarjeta de un miembro

  Como quien tiene una colección de cuarenta documentos
  Quiero ver el primer párrafo de cada uno en su tarjeta
  Para saber qué hay sin abrir cuarenta archivos

  Regla de negocio: El fragmento junta párrafos hasta el máximo, y lo que no es texto se salta

    Esquema del escenario: El fragmento es el primer párrafo de verdad
      Dado que el documento tiene el cuerpo:
      """
      <cuerpo>
      """
      Cuando extraigo su fragmento
      Entonces el fragmento es "<esperado>"

      Ejemplos:
        | cuerpo | esperado |
        | Una frase corta.<br><br>Y otra que no entra. | Una frase corta.<br><br>Y otra que no entra. |
        | # Título<br><br>## Subtítulo<br><br>El párrafo de verdad. | El párrafo de verdad. |
        | Título del documento<br>=====================<br><br>Tras el título. | Tras el título. |
        | ```js<br>codigo();<br>```<br><br>Tras el código. | Tras el código. |
        | - uno<br>- dos<br><br>Tras la lista. | Tras la lista. |
        | > una cita<br><br>Tras la cita. | Tras la cita. |

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

  Regla de negocio: El texto de un bloque `:::` cuenta como párrafo

    Escenario: Un bloque corto se toma como texto y sigue el resto
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
      Contenido corto de la nota.

      Después del div.
      """

    Escenario: Un bloque largo se recorta con puntos suspensivos
      Dado que el cuerpo es un bloque de 150 palabras
      Cuando extraigo su fragmento
      Entonces el fragmento se corta con puntos suspensivos
      Y el fragmento tiene 101 palabras

    Escenario: Un bloque sin cerrar se toma como texto
      Dado que el documento tiene el cuerpo:
      """
      ::: {.nota}
      Contenido sin cierre.
      """
      Cuando extraigo su fragmento
      Entonces el fragmento es:
      """
      Contenido sin cierre.
      """

  Regla de negocio: El recorte no parte un enlace

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

    Escenario: El fragmento de una tarjeta se corta a 20 palabras
      Dado que el cuerpo es un párrafo con 150 palabras
      Cuando extraigo su fragmento con máximo 20
      Entonces el fragmento se corta con puntos suspensivos
      Y el fragmento tiene 21 palabras
