# language: es
Característica: el post-proceso del HTML y los formatos del argv

  Como quien abre el resultado en el navegador
  Quiero que las referencias salgan en su propia tarjeta y el cuerpo de la
  colección arriba del todo
  Para no encontrar las referencias al final de un artículo de cuarenta páginas

  # Tramo 24 de la migración. 16 de los 19 casos de `html-composer.test.ts`.

  # El HTML va en docstring y no en tabla: son cadenas de varias líneas con
  # comillas y llaves, y escaparlas a mano es el mismo problema que con el JSON
  # del crop.

  Regla de negocio: El bloque de referencias sale del article con su cierre balanceado

    # Los `div` de una entrada de bibliografía se anidan (`csl-left-margin`,
    # `csl-right-inline`), así que el primer `</div>` no cierra el bloque. El
    # extractor lleva la cuenta de profundidad: sin ella se llevaría medio
    # artículo en la tarjeta.

    Escenario: El bloque sale entero con los divs anidados
      Dado que la raíz del proyecto está vacía
      Y que el HTML es:
      """
      <article><p>Texto.</p><h1 id="refs-heading">Referencias</h1><div id="refs" class="references"><div class="csl-entry"><div class="csl-left-margin">(1)</div><div class="csl-right-inline">Entrada.</div></div></div></article>
      """
      Cuando extraigo el bloque de referencias
      Entonces el bloque de referencias se extrajo
      Y el post-proceso quita "refs-heading"
      Y el bloque de referencias se extrajo

    # Sin cierre balanceado no se extrae nada y el HTML vuelve intacto: medio
    # bloque en la tarjeta es peor que ninguno.
    Escenario: Un bloque sin cerrar no se extrae y el HTML vuelve intacto
      Dado que la raíz del proyecto está vacía
      Y que el HTML es:
      """
      <h1 id="refs-heading">Referencias</h1><div id="refs"><div class="csl-entry"><div>sin cerrar</div>
      """
      Cuando extraigo el bloque de referencias
      Entonces el bloque de referencias no se extrajo
      Y el post-proceso no tocó el HTML

    # #2080: HTML mal balanceado avisa. Sin el aviso, el autor ve una página a
    # medias y no sabe si el fallo es suyo o del build.
    Escenario: El HTML mal balanceado avisa y devuelve la entrada intacta
      Dado que la raíz del proyecto está vacía
      Y que el HTML es:
      """
      <article><h1 id="refs-heading">Refs</h1><div id="refs"><div class="filtro"><p>roto</p></div>
      """
      Cuando extraigo el bloque de referencias
      Entonces el bloque de referencias no se extrajo
      Y el post-proceso no tocó el HTML
      Y el post-proceso avisa que "HTML mal balanceado"

    # El marcador sin `div#refs` es un caso aparte: se quita el heading
    # sintético y el marcador, pero no hay bloque que sacar.
    Escenario: El marcador sin referencias se quita igual
      Dado que la raíz del proyecto está vacía
      Y que el HTML es:
      """
      <article><h1 id="refs-heading">Referencias</h1></article>
      """
      Y que el HTML lleva el marcador de referencias
      Cuando extraigo el bloque de referencias
      Entonces el bloque de referencias no se extrajo
      Y el post-proceso quita "refs-heading"
      Y el post-proceso deja "<article></article>"

    # El heading propio del autor tiene `id="referencias"`, no `refs-heading`.
    # Tocarlo sería quitarle su propio índice.
    Escenario: Un heading propio del documento nunca se toca
      Dado que la raíz del proyecto está vacía
      Y que el HTML es:
      """
      <article><h1 id="referencias">Referencias</h1><p>Manual.</p></article>
      """
      Cuando extraigo el bloque de referencias
      Entonces el bloque de referencias no se extrajo
      Y el post-proceso no tocó el HTML

    Escenario: Un HTML sin referencias no se toca
      Dado que la raíz del proyecto está vacía
      Y que el HTML es:
      """
      <article><p>Texto.</p></article>
      """
      Cuando extraigo el bloque de referencias
      Entonces el bloque de referencias no se extrajo
      Y el post-proceso no tocó el HTML

  Regla de negocio: El índice no ofrece un enlace a las referencias

    Escenario: El ítem de referencias sale del índice
      Dado que la raíz del proyecto está vacía
      Y que el HTML es:
      """
      <nav><ul><li><a href="#seccion">Sección</a></li><li><a href="#refs-heading">Referencias</a></li></ul></nav>
      """
      Cuando quito el enlace a referencias del índice
      Entonces el HTML no dice "#refs-heading"
      Y el post-proceso deja "<a href=\"#seccion\">Sección</a>"

    Escenario: Sin ítem de referencias el índice no cambia
      Dado que la raíz del proyecto está vacía
      Y que el HTML es:
      """
      <nav><ul><li><a href="#seccion">Sección</a></li></ul></nav>
      """
      Cuando quito el enlace a referencias del índice
      Entonces el post-proceso no tocó el HTML

  Regla de negocio: El argv lleva un valor corto por formato, nunca HTML

    # #2445. Un `<` en un `--variable` de pandoc rompe el argv: el valor se
    # corta en el primer espacio y el formato sale con el href a medias. El
    # markup de la tarjeta vive en la plantilla; el argv sólo lleva el href.

    Escenario: Sin formatos no hay flag
      Dado que la raíz del proyecto está vacía
      Y que los formatos son "[]"
      Cuando compongo el flag de formatos
      Y compongo los argumentos de formatos
      Entonces el flag de formatos no existe
      Y los argumentos de formatos son ""

    Escenario: Con formatos el flag es un valor corto
      Dado que la raíz del proyecto está vacía
      Y que los formatos son '[{"href":"./doc.pdf","key":"pdf","name":"PDF","description":"Documento final"},{"href":"./doc.epub","key":"epub","name":"EPUB","description":"Edición adaptable"}]'
      Cuando compongo el flag de formatos
      Entonces el flag de formatos es "1"

    Escenario: Cada formato aporta exactamente un href corto
      Dado que la raíz del proyecto está vacía
      Y que los formatos son '[{"href":"./doc.pdf","key":"pdf","name":"PDF","description":"Documento final"},{"href":"./doc.epub","key":"epub","name":"EPUB","description":"Edición adaptable"}]'
      Cuando compongo los argumentos de formatos
      Entonces los argumentos de formatos son "--variable=fmt-pdf:./doc.pdf, --variable=fmt-epub:./doc.epub"
      Y ningún argumento de formatos lleva HTML ni saltos

  Regla de negocio: El body propio de la colección sube a la banda

    # #2487. Los datos de la colección ya no viajan en el cuerpo fusionado: la
    # banda de metadatos los imprime con los de pandoc. El intro sube con su
    # div anidado entero, y el marco del texto lo pone el post-proceso.

    Escenario: El intro sube entero y antes del main
      Dado que la raíz del proyecto está vacía
      Y que el HTML es:
      """
      <body><div class="banda"><!-- block:intro --></div><main><div class="collection-intro"><p>Intro de la antología.</p><div class="nota"><p>con un div anidado</p></div></div><p>resto</p></main>
      """
      Cuando subo el body propio a la banda
      Entonces el post-proceso deja "<p>Intro de la antología.</p>"
      Y el post-proceso deja "<div class=\"nota\"><p>con un div anidado</p></div>"
      Y el post-proceso quita "collection-intro"
      Y el post-proceso deja "text-left prose prose-xl"
      Y el post-proceso deja "<p>resto</p>"
      Y el post-proceso pone "Intro de la antología." antes que "<main>"

    Escenario: Sin body propio no se toca nada
      Dado que la raíz del proyecto está vacía
      Y que el HTML es:
      """
      <body><main><p>Sin intro.</p></main>
      """
      Cuando subo el body propio a la banda
      Entonces el post-proceso no tocó el HTML

    # Un intro vacío no puede dejar un div: el autor vería un hueco en la banda.
    Escenario: Un intro vacío no deja div ni hueco
      Dado que la raíz del proyecto está vacía
      Y que el HTML es:
      """
      <body><div class="banda"><!-- block:intro --></div><main><div class="collection-intro">   </div></main>
      """
      Cuando subo el body propio a la banda
      Entonces el HTML no dice "prose"
      Y el post-proceso deja "<body><div class=\"banda\"></div><main></main>"

    # Sin el marcador de la banda el intro se saca igual, y avisa: el autor
    # puso el intro fuera de `format.html.blocks` y no lo sabe.
    Escenario: Sin el marcador de la banda el intro se saca y avisa
      Dado que la raíz del proyecto está vacía
      Y que el HTML es:
      """
      <main><div class="collection-intro"><p>Intro.</p></div><p>resto</p></main>
      """
      Cuando subo el body propio a la banda
      Entonces el HTML no dice "collection-intro"
      Y el post-proceso deja "<p>resto</p>"
      Y el post-proceso avisa que "format.html.blocks"