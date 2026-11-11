# language: es
Característica: new crea documentos por type

  Como quien agrega una colección, una creadora o un anuncio
  Quiero que new escriba el frontmatter de su type
  Para no recordar cada campo obligatorio

  Regla de negocio: Un type conocido decide el frontmatter y la ruta por defecto

    Esquema del escenario: new <tipo> crea <archivo> con type <type>
      Dado que la raíz del proyecto está vacía
      Cuando parseo el comando "new <tipo>" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "<archivo>" existe
      Y el frontmatter de "<archivo>" declara el campo "type" con el valor "<type>"

      Ejemplos:
        | tipo      | archivo      | type         |
        | texto     | texto.md     | file         |
        | coleccion | coleccion.md | collection   |
        | creadora  | creadora.md  | creator      |
        | libro     | libro.md     | collection   |
        | anuncio   | anuncio.md   | announcement |
        | lista     | lista.md     | list         |

    Escenario: new creadora usa name
      Dado que la raíz del proyecto está vacía
      Cuando parseo el comando "new creadora" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 0
      Y el frontmatter de "creadora.md" declara el campo "name" con el valor "Creadora"

    Escenario: new anuncio trae fecha y ubicación
      Dado que la raíz del proyecto está vacía
      Cuando parseo el comando "new anuncio" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "anuncio.md" tiene la clave "date:"
      Y el frontmatter de "anuncio.md" declara el campo "placement" con el valor "top"

    Escenario: new lista trae el orden cronológico
      Dado que la raíz del proyecto está vacía
      Cuando parseo el comando "new lista" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 0
      Y el frontmatter de "lista.md" declara el campo "order" con el valor "date-desc"

  Regla de negocio: Una ruta suelta conserva el comportamiento anterior

    Escenario: new posts/mi-articulo.md sigue creando el documento genérico
      Dado que la raíz del proyecto está vacía
      Cuando parseo el comando "new posts/mi-articulo.md" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "posts/mi-articulo.md" existe
      Y el frontmatter de "posts/mi-articulo.md" declara el título "Mi Articulo"
      Y el frontmatter de "posts/mi-articulo.md" no menciona "type:"
