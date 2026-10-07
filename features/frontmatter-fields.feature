# language: es
Característica: cómo se lee un campo del frontmatter

  Como quien escribe un libro con varios autores
  Quiero que el CLI lea mi `creator` sin adivinar
  Para que no aparezca nada ilegible en la portada

  Regla de negocio: Un texto se acepta tal cual

    Escenario: Un texto con espacios se respeta tal cual
      Dado que la raíz del proyecto está vacía
      Y el valor de campo es la cadena " hola "
      Cuando lo leo como texto
      Entonces lo leo como " hola "

    Escenario: Una cadena vacía cae al valor por defecto
      Dado que la raíz del proyecto está vacía
      Y el valor de campo es la cadena vacía
      Cuando lo leo como texto
      Entonces lo leo como "x"

    Escenario: Un número no es un texto
      Dado que la raíz del proyecto está vacía
      Y el valor de campo es el número 3
      Cuando lo leo como texto
      Entonces lo leo como "x"

    Escenario: Sin valor no hay texto
      Dado que la raíz del proyecto está vacía
      Y el valor de campo está ausente
      Cuando lo leo como texto
      Entonces lo leo como "x"

  Regla de negocio: Recortar es parte de decidir

    Escenario: Recortar quita los bordes
      Dado que la raíz del proyecto está vacía
      Y el valor de campo es la cadena "  hola "
      Cuando lo leo como texto recortado
      Entonces lo leo como "hola"

    Escenario: Un texto de sólo espacios es un hueco
      Dado que la raíz del proyecto está vacía
      Y el valor de campo es la cadena "   "
      Cuando lo leo como texto recortado
      Entonces lo leo como nada

    Escenario: Un número tampoco es un texto recortado
      Dado que la raíz del proyecto está vacía
      Y el valor de campo es el número 5
      Cuando lo leo como texto recortado
      Entonces lo leo como nada

  Regla de negocio: Un booleano es un booleano

    Escenario: false es un booleano y vale false
      Dado que la raíz del proyecto está vacía
      Y el valor de campo es el booleano "false"
      Cuando lo leo como booleano con el valor por defecto "true"
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
      Entonces lo leo el valor true

  Regla de negocio: Una lista acepta un texto y descarta los huecos

    Escenario: Un texto solo es una lista de uno
      Dado que la raíz del proyecto está vacía
      Y el valor de campo es la cadena "Uno"
      Cuando lo leo como lista
      Entonces lo leo como la lista "Uno"

    Escenario: Una lista se recorta y le quita los huecos
      Dado que la raíz del proyecto está vacía
      Y el valor de campo es la lista " A ;;  ;; B"
      Cuando lo leo como lista
      Entonces lo leo como la lista "A ;; B"

    Escenario: Una lista con números se queda con los textos
      Dado que la raíz del proyecto está vacía
      Y el valor de campo es la lista mixta "1 ;; a ;; 2"
      Cuando lo leo como lista
      Entonces lo leo como la lista "a"

    Escenario: Una lista vacía no es una lista
      Dado que la raíz del proyecto está vacía
      Y el valor de campo es la lista vacía
      Cuando lo leo como lista
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
      Entonces lo leo como "Del fm"

    Escenario: Sin frontmatter gana el formato
      Dado el frontmatter no tiene nada
      Y el formato tiene: "title=Del formato"
      Y la raíz tiene: "title=De la raíz"
      Y el campo "title"
      Cuando resuelvo el campo como texto
      Entonces lo leo como "Del formato"

    Escenario: Sin frontmatter ni formato gana la raíz
      Dado el frontmatter no tiene nada
      Y la raíz tiene: "date=1999-12-31"
      Y el campo "date"
      Cuando resuelvo el campo como texto con el formato ausente
      Entonces lo leo como "1999-12-31"

    Escenario: Un valor del tipo equivocado se descarta y se busca más abajo
      Dado el frontmatter no tiene nada
      Y el formato no tiene nada
      Y la raíz tiene: "creator=listaAutor raíz"
      Y el campo "creator"
      Cuando resuelvo el campo como texto
      Entonces no leo nada

  Regla de negocio: Los metadatos no descargan el tipo

    Escenario: Los metadatos devuelven el valor crudo del primer nivel
      Dado el frontmatter tiene: "creator=listaAutor FM"
      Y el formato tiene: "creator=Autor formato"
      Y la raíz tiene: "creator=listaAutor raíz"
      Y el campo "creator"
      Cuando resuelvo el campo como metadato
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
      Entonces lo leo el valor true

    Escenario: El formato gana si el frontmatter no lo dice
      Dado el frontmatter tiene: "nada"
      Y el formato tiene: "showDate=false"
      Y la raíz tiene: "showDate=true"
      Y el campo "showDate"
      Cuando resuelvo el campo como booleano
      Entonces lo leo el valor false

    Escenario: La raíz gana si nadie más lo dice
      Dado el frontmatter tiene: "nada"
      Y el formato tiene: "nada"
      Y la raíz tiene: "showDate=true"
      Y el campo "showDate"
      Cuando resuelvo el campo como booleano
      Entonces lo leo el valor true

    Escenario: El texto que parece un booleano no lo es
      Dado el frontmatter tiene: "showDate=texto"
      Y el formato tiene: "nada"
      Y la raíz no tiene nada
      Y el campo "showDate"
      Cuando resuelvo el campo como booleano
      Entonces no leo nada

    Escenario: El número que parece un booleano no lo es
      Dado el frontmatter tiene: "nada"
      Y el formato tiene: "showDate=uno"
      Y la raíz no tiene nada
      Y el campo "showDate"
      Cuando resuelvo el campo como booleano
      Entonces no leo nada

    Escenario: Si ningún nivel lo define, no hay booleano
      Dado el frontmatter no tiene nada
      Y el formato no tiene nada
      Y la raíz no tiene nada
      Y el campo "courtesyPage"
      Cuando resuelvo el campo como booleano
      Entonces no leo nada