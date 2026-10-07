# language: es
Característica: cómo se lee un campo del frontmatter

  Como quien escribe un libro con varios autores
  Quiero que el CLI lea mi `creator` sin adivinar
  Para que no aparezca nada ilegible en la portada

  # Tramo 37 de la migración. 13 de los 13 casos de `frontmatter-fields.test.ts`.
  # El archivo queda cerrado.

  # Tres niveles: el frontmatter del documento, la sección `format` de la config
  # y la raíz del documento. El primero que habla gana. Y un valor presente pero
  # con el tipo equivocado NO cuenta como "habla": se descarta y se busca más
  # abajo. Si no, un `creator` escrito donde se espera una lista se colaría al
  # PDF como algo ilegible.

  # El tipo del valor va en el texto del paso, no en el valor. Con `Ejemplos`
  # el texto del paso es el mismo para todas las filas, así que lo único que
  # puede cambiar por fila es el valor; por eso aquí hay más escenarios de los
  # que haría falta con una tabla.

  Regla de negocio: Un texto se acepta tal cual

    Escenario: Un texto con espacios se respeta tal cual
      Dado que la raíz del proyecto está vacía
      Y el valor de campo es la cadena " hola "
      Cuando lo leo como texto
      # Sin recortar: aquí el espaciado es decisión del autor.
      Entonces lo leo como " hola "

    Escenario: Una cadena vacía cae al valor por defecto
      Dado que la raíz del proyecto está vacía
      Y el valor de campo es la cadena vacía
      Cuando lo leo como texto
      # Vacío no es un texto: vale el valor por defecto.
      Entonces lo leo como "x"

    Escenario: Un número no es un texto
      Dado que la raíz del proyecto está vacía
      Y el valor de campo es el número 3
      Cuando lo leo como texto
      # Un número donde se espera texto no se convierte: se descarta.
      Entonces lo leo como "x"

    Escenario: Sin valor no hay texto
      Dado que la raíz del proyecto está vacía
      Y el valor de campo está ausente
      Cuando lo leo como texto
      Entonces lo leo como "x"

  Regla de negocio: Recortar es parte de decidir

    # Un texto que sólo son espacios está vacío aunque no sea la cadena vacía:
    # se descarta, igual que un título que el autor no escribió.

    Escenario: Recortar quita los bordes
      Dado que la raíz del proyecto está vacía
      Y el valor de campo es la cadena "  hola "
      Cuando lo leo como texto recortado
      # El recorte es aquí una decisión: el borde no aporta nada.
      Entonces lo leo como "hola"

    Escenario: Un texto de sólo espacios es un hueco
      Dado que la raíz del proyecto está vacía
      Y el valor de campo es la cadena "   "
      Cuando lo leo como texto recortado
      # No es un texto: recortado queda vacío.
      Entonces lo leo como nada

    Escenario: Un número tampoco es un texto recortado
      Dado que la raíz del proyecto está vacía
      Y el valor de campo es el número 5
      Cuando lo leo como texto recortado
      Entonces lo leo como nada

  Regla de negocio: Un booleano es un booleano

    # El texto "false" no es un booleano. Adivinarlo es la peor de las opciones:
    # el autor escribió algo y el build decidió otra cosa, sin avisar.

    Escenario: false es un booleano y vale false
      Dado que la raíz del proyecto está vacía
      Y el valor de campo es el booleano "false"
      Cuando lo leo como booleano con el valor por defecto "true"
      # `false` no es el defecto aunque el defecto sea `true`.
      Entonces lo leo el valor false

    Escenario: Sin booleano se usa el defecto
      Dado que la raíz del proyecto está vacía
      Y el valor de campo está ausente
      Cuando lo leo como booleano con el valor por defecto "false"
      Entonces lo leo el valor false

    Escenario: El texto "false" no es el booleano false
      Dado que la raíz del proyecto está vacía
      Y el valor de campo es la cadena "false"
      Cuando lo leo como booleano con el valor por defecto "true"
      # Lo que no es booleano cae al defecto, que aquí es `true`.
      Entonces lo leo el valor true

  Regla de negocio: Una lista acepta un texto y descarta los huecos

    # `creator: Autora` y `creator: [Autora]` tienen que dar lo mismo, y un hueco
    # en medio de la lista no es un autor: es un hueco.

    Escenario: Un texto solo es una lista de uno
      Dado que la raíz del proyecto está vacía
      Y el valor de campo es la cadena "Uno"
      Cuando lo leo como lista
      # Un texto único se envuelve en una lista.
      Entonces lo leo como la lista "Uno"

    Escenario: Una lista se recorta y le quita los huecos
      Dado que la raíz del proyecto está vacía
      Y el valor de campo es la lista " A ;;  ;; B"
      Cuando lo leo como lista
      # El hueco del medio no ocupa sitio: no es un autor.
      Entonces lo leo como la lista "A ;; B"

    Escenario: Una lista con números se queda con los textos
      Dado que la raíz del proyecto está vacía
      Y el valor de campo es la lista mixta "1 ;; a ;; 2"
      Cuando lo leo como lista
      # Los números no son autores.
      Entonces lo leo como la lista "a"

    Escenario: Una lista vacía no es una lista
      Dado que la raíz del proyecto está vacía
      Y el valor de campo es la lista vacía
      Cuando lo leo como lista
      # Sin valores útiles no hay lista: se devuelve la ausencia.
      Entonces lo leo como nada

    Escenario: Una lista de sólo números tampoco es una lista
      Dado que la raíz del proyecto está vacía
      Y el valor de campo es la lista mixta ""
      Cuando lo leo como lista
      Entonces lo leo como nada

  Regla de negocio: El primer nivel que habla gana

    Escenario: Con los tres niveles, gana el frontmatter
      Dado el frontmatter tiene: "title=Del fm"
      Y el formato tiene: "title=Del formato"
      Y la raíz tiene: "title=De la raíz"
      Y el campo "title"
      Cuando resuelvo el campo como texto
      # El más cercano al documento manda: es lo más específico.
      Entonces lo leo como "Del fm"

    Escenario: Sin frontmatter gana el formato
      Dado el frontmatter no tiene nada
      Y el formato tiene: "title=Del formato"
      Y la raíz tiene: "title=De la raíz"
      Y el campo "title"
      Cuando resuelvo el campo como texto
      # Baja un nivel, no al primero que responda por casualidad.
      Entonces lo leo como "Del formato"

    Escenario: Sin frontmatter ni formato gana la raíz
      Dado el frontmatter no tiene nada
      Y la raíz tiene: "date=1999-12-31"
      Y el campo "date"
      Cuando resuelvo el campo como texto con el formato ausente
      # El tercer nivel no es menos válido: es el menos específico.
      Entonces lo leo como "1999-12-31"

    # El tipo importa: una lista no es un `title` de texto, así que no "habla".
    Escenario: Un valor del tipo equivocado se descarta y se busca más abajo
      Dado el frontmatter no tiene nada
      Y el formato no tiene nada
      Y la raíz tiene: "creator=listaAutor raíz"
      Y el campo "creator"
      Cuando resuelvo el campo como texto
      # La lista no es un texto: se descarta y no hay nada más abajo.
      Entonces no leo nada

  Regla de negocio: Los metadatos no descargan el tipo

    # `resolveMetadataField` devuelve el valor CRUDO del primer nivel que lo
    # tenga, sin validar: quien lo pide ya sabe qué tipo espera.

    Escenario: Los metadatos devuelven el valor crudo del primer nivel
      Dado el frontmatter tiene: "creator=listaAutor FM"
      Y el formato tiene: "creator=Autor formato"
      Y la raíz tiene: "creator=listaAutor raíz"
      Y el campo "creator"
      Cuando resuelvo el campo como metadato
      # La lista del frontmatter tal cual, sin aplanar ni validar.
      Entonces lo leo como la lista "Autor FM"

    Escenario: Un campo que nadie define no se inventa
      Dado el frontmatter no tiene nada
      Y el formato no tiene nada
      Y la raíz no tiene nada
      Y el campo "subject"
      Cuando resuelvo el campo como metadato
      Entonces no leo nada

  Regla de negocio: Los booleanos también bajan por la jerarquía

    Escenario: El frontmatter gana
      Dado el frontmatter tiene: "showDate=true"
      Y el formato tiene: "showDate=false"
      Y la raíz tiene: "showDate=true"
      Y el campo "showDate"
      Cuando resuelvo el campo como booleano
      # El más específico manda aunque diga `true` y los de abajo `false`.
      Entonces lo leo el valor true

    Escenario: El formato gana si el frontmatter no lo dice
      Dado el frontmatter tiene: "nada"
      Y el formato tiene: "showDate=false"
      Y la raíz tiene: "showDate=true"
      Y el campo "showDate"
      Cuando resuelvo el campo como booleano
      # `false` del formato gana a `true` de la raíz: manda el de arriba.
      Entonces lo leo el valor false

    Escenario: La raíz gana si nadie más lo dice
      Dado el frontmatter tiene: "nada"
      Y el formato tiene: "nada"
      Y la raíz tiene: "showDate=true"
      Y el campo "showDate"
      Cuando resuelvo el campo como booleano
      # El tercer nivel también vale.
      Entonces lo leo el valor true

    # Un valor que no es booleano no habla: ni el texto "true" ni el 1.
    Escenario: El texto que parece un booleano no lo es
      Dado el frontmatter tiene: "showDate=texto"
      Y el formato tiene: "nada"
      Y la raíz no tiene nada
      Y el campo "showDate"
      Cuando resuelvo el campo como booleano
      # Los tres niveles son inválidos: no hay nada que devolver.
      Entonces no leo nada

    Escenario: El número que parece un booleano no lo es
      Dado el frontmatter tiene: "nada"
      Y el formato tiene: "showDate=uno"
      Y la raíz no tiene nada
      Y el campo "showDate"
      Cuando resuelvo el campo como booleano
      # 1 no es `true`.
      Entonces no leo nada

    Escenario: Si ningún nivel lo define, no hay booleano
      Dado el frontmatter no tiene nada
      Y el formato no tiene nada
      Y la raíz no tiene nada
      Y el campo "courtesyPage"
      Cuando resuelvo el campo como booleano
      Entonces no leo nada