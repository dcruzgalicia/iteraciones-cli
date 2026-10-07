# language: es
Característica: la tarjeta de cada miembro de una colección

  Como quien publica una antología
  Quiero que cada documento sea una tarjeta con su autor, su título y un fragmento
  Para recorrer la colección sin abrir los cuarenta archivos

  # Tramo 10 de la migración. Los 15 casos restantes de
  # `collection-fragment.test.ts`.

  Regla de negocio: El cuerpo propio de la colección sube a la banda

    # Antes, los datos de la colección viajaban en el cuerpo fusionado con los
    # de sus miembros. Ahora la banda de metadatos los imprime con los de
    # pandoc, y el cuerpo propio sube como un bloque aparte — envuelto en su
    # `::::`, porque un `::: {class="collection-intro"}` suelto se lo comería
    # el post-proceso.

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
      # El frontmatter ya no viaja: la banda lo imprime. Si siguiera en el
      # cuerpo, la portada de la HTML tendría los datos dos veces.
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

    # #2487: el pseudo `after:inset-0` del enlace cubre la tarjeta entera, así
    # que un click en cualquier punto va al documento. Por eso la tarjeta tiene
    # que ser `relative` y el "leer" un párrafo centrado.
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
      # Anidar una tarjeta dentro de otra hace que el masonry las reparta
      # como una sola, y las columnas quedan desalineadas.
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
      # Sin slug no hay HTML al que apuntar. El texto sigue: una tarjeta sin
      # enlace es mejor que un enlace roto.
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

    # La tarjeta con fragmento es una decisión de la HTML: en un EPUB en
    # pantalla estrecha, cuarenta fragmentos son cuarenta párrafos de relleno
    # y el texto completo es lo que el lector pidió.

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

    # Las imágenes de la portada de la colección están en su cuerpo, que la
    # tarjeta no muestra. El escaneo tiene que recibirlo entero o la portada se
    # pierde en el PDF.

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
      # Un triple salto de línea rompe el markdown que se vuelve a parsear
      # después: el scanner emite los bloques separados por una línea en blanco.
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

    # Un `.html` enlazado desde la raíz de la colección funciona; desde un
    # subdirectorio hay que subir. Sin el `../`, el enlace apunta a una ruta
    # que no existe y el navegador se queda en un 404 silencioso.

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