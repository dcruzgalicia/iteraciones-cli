# language: es
Característica: la tarjeta de cada miembro de una colección

  Como quien publica una antología
  Quiero que cada documento sea una tarjeta con su autor, su título y un fragmento
  Para recorrer la colección sin abrir los cuarenta archivos

  Regla de negocio: El cuerpo propio de la colección sube a la banda

    Escenario: El cuerpo propio viaja envuelto y va primero
      Dado que la colección tiene 1 miembros
      Y que la colección tiene el cuerpo propio:
      """
      ---
      title: Antología
      ---

      Intro de la antología.
      """
      Cuando compogo las tarjetas de la página HTML
      Entonces el HTML no dice "tarjeta-coleccion"
      Y el HTML no dice "Antología"
      Y el HTML no dice "---"
      Y el HTML dice ":::: {class=\"collection-intro\"}"
      Y el HTML dice "Intro de la antología."
      Y el HTML pone "collection-intro" antes que "tarjeta-fragmento"
      Y el HTML tiene 1 contenedores de masonry

    Escenario: Sin cuerpo propio no hay nada que subir a la banda
      Dado que la colección tiene 1 miembros
      Y que la colección tiene el cuerpo propio:
      """
      ---
      title: Antología
      ---
      """
      Cuando compogo las tarjetas de la página HTML
      Entonces el HTML no dice "collection-intro"
      Y el HTML dice "tarjeta-fragmento"

  Regla de negocio: Una tarjeta por miembro, con su autor y su fragmento

    Escenario: La tarjeta lleva autor, título, fragmento y enlace
      Dado que la colección tiene 1 miembros
      Y que la colección tiene el cuerpo propio:
      """
      cuerpo propio
      """
      Cuando compogo las tarjetas de la página HTML
      Entonces el HTML dice "tarjeta-fragmento"
      Y el HTML dice "<h2 class=\"text-center text-xl\"><span class=\"whitespace-nowrap\">Autora A</span></h2>"
      Y el HTML dice "<h3 class=\"text-center text-2xl text-accent-700 dark:text-accent-300\">Documento</h3>"
      Y el HTML dice "Contenido de doc."
      Y el HTML dice "Leer el texto completo →"

    Escenario: El enlace cubre la tarjeta entera y su línea va centrada
      Dado que la colección tiene 1 miembros
      Y que la colección tiene el cuerpo propio:
      """
      """
      Cuando compogo las tarjetas de la página HTML
      Entonces el HTML dice "<a href=\"./documento-por-autora-a.html\" class=\"after:absolute after:inset-0\">"
      Y el HTML dice "tarjeta-fragmento relative"
      Y el HTML dice "<p class=\"text-center\">"

    Escenario: Cada tarjeta va en su propio contenedor del masonry
      Dado que la colección tiene 1 miembros
      Y que la colección tiene el cuerpo propio:
      """
      """
      Cuando compogo las tarjetas de la página HTML
      Entonces el HTML tiene 1 contenedores de masonry

    Escenario: La tarjeta no fusiona el cuerpo completo del miembro
      Dado que la colección tiene un cuerpo propio con 150 palabras
      Y que la colección tiene el cuerpo propio:
      """
      """
      Cuando compogo las tarjetas de la página HTML
      Entonces el HTML no dice "Segundo párrafo que no debe aparecer."
      Y el HTML tiene 1 contenedores de masonry

    Escenario: Un miembro sin slug se queda sin enlace
      Dado que la colección tiene 1 miembros
      Y que un miembro está en "sin-slug.md"
      Y que la colección tiene el cuerpo propio:
      """
      """
      Cuando compogo las tarjetas de la página HTML
      Entonces el HTML no dice "Leer el texto completo"
      Y el HTML dice "Contenido de doc."

    Escenario: Una colección sin miembros devuelve su cuerpo propio
      Dado que la colección tiene 0 miembros
      Y que la colección tiene el cuerpo propio:
      """
      cuerpo propio
      """
      Cuando compogo las tarjetas de la página HTML
      Entonces el HTML es "cuerpo propio"

  Regla de negocio: El EPUB sigue llevando la fusión completa

    Escenario: El EPUB recibe el cuerpo entero del miembro
      Dado que la colección tiene un cuerpo propio con 150 palabras y un segundo párrafo
      Y que la colección tiene el cuerpo propio:
      """
      ---
      title: Antología
      ---
      """
      Cuando compongo el HTML base para el EPUB
      Entonces el HTML dice "Segundo párrafo que sí debe aparecer."
      Y el HTML no dice "tarjeta-fragmento"

  Regla de negocio: El escaneo de imágenes necesita el cuerpo propio

    Escenario: El escaneo ve la portada del cuerpo propio y las secciones
      Dado que la colección tiene 1 miembros
      Y que la colección tiene el cuerpo propio:
      """
      ---
      title: Antología
      ---

      ![portada](img/portada.png)
      """
      Cuando escaneo las imágenes de la collection
      Entonces el HTML dice "![portada](img/portada.png)"
      Y el HTML dice "Contenido de doc."

    Escenario: Sin cuerpo propio, el escaneo solo ve las secciones
      Dado que la colección tiene 1 miembros
      Y que la colección tiene el cuerpo propio:
      """
      ---
      title: Antología
      ---
      """
      Cuando escaneo las imágenes de la collection
      Entonces el HTML dice "Contenido de doc."
      Y el HTML no tiene triple salto de línea

    Escenario: Un documento que no es colección se devuelve tal cual
      Dado que la colección tiene 0 miembros
      Y que la colección tiene el cuerpo propio:
      """
      ---
      title: Antología
      ---

      ![portada](img/portada.png)
      """
      Cuando escaneo las imágenes de la collection
      Entonces el HTML no dice "Contenido de doc."
      Y el HTML dice "![portada](img/portada.png)"

  Regla de negocio: El enlace de un miembro es relativo a donde vive la colección

    Escenario: Desde la raíz, el enlace es directo
      Dado que la colección está en "coleccion.md"
      Y que un miembro está en "doc.md"
      Cuando calculo los enlaces al HTML de cada miembro
      Entonces el enlace del miembro es "./documento-por-autora-a.html"

    Escenario: Desde un subdirectorio, el enlace sube
      Dado que la colección está en "anexos/coleccion.md"
      Y que un miembro está en "anexos/doc.md"
      Cuando calculo los enlaces al HTML de cada miembro
      Entonces el enlace del miembro es "./../anexos/documento-por-autora-a.html"

    Escenario: Un miembro sin slug no entra en el mapa de enlaces
      Dado que la colección está en "coleccion.md"
      Y que un miembro está en "sin-slug.md"
      Cuando calculo los enlaces al HTML de cada miembro
      Entonces el miembro no tiene enlace