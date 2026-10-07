# language: es
Característica: la plantilla HTML que se entrega a pandoc

  Como quien abre el resultado en el navegador
  Quiero que las tarjetas salgan en un orden que se pueda recorrer
  Para que la portada, el índice, la descarga y el contenido no se mezclen

  # Tramo 16 de la migración. 9 de los 28 casos de `render.test.ts`.

  # El compositor no decide qué bloques se imprimen —eso lo dice el flag— pero
  # sí dónde van y qué HTML hay dentro. Los pasos hablan de "la tarjeta del
  # título" y no de `html-composer.ts`.
  #
  # `Tarjeta identidad`, `Tarjeta documento` y `$doc-chip$` son comentarios que
  # el compositor deja en la plantilla. Son el ancla estable: el texto de la
  # tarjeta cambia con cada ajuste de estilo, el comentario no.

  Regla de negocio: El orden por defecto de las tarjetas

    Escenario: Cada tarjeta va detrás de la anterior
      Dado que la plantilla HTML se compone para "file"
      Entonces la plantilla ordena "$doc-chip$, $if(toc)$, $if(formats)$, $if(has-references)$"
      Y la plantilla dice "$if(home-href)$"

    # El bloque de referencias entero va detrás de un `$if$`: sin el flag, el
    # compositor no emite nada y no queda una tarjeta hueca.
    Escenario: La tarjeta de referencias es condicional
      Dado que la plantilla HTML se compone para "file"
      Entonces la plantilla dice "$if(has-references)$"
      Y la plantilla dice "<div id=\"block-referencias\"></div>"

    # La tarjeta de formatos no se arma en el argv: icono, nombre y
    # descripción van horneados en la plantilla y el argv sólo aporta el href.
    Escenario: La tarjeta de formatos es un flag y un hueco por formato
      Dado que la plantilla HTML se compone para "file"
      Entonces la plantilla dice "$if(formats)$"
      Y la plantilla dice "$fmt-pdf$"
      Y la plantilla dice "$fmt-epub$"
      Y la plantilla no dice "$formats$"

  Regla de negocio: Reordenar bloques mueve las del medio, no el header ni el footer

    # El header abre el masonry y el footer lo cierra. Si el autor los
    # reordenara, el `<main>` quedaría mal cerrado y el HTML entero se
    # descompone. Las del medio sí siguen el orden configurado.

    Escenario: Una lista explícita pone los formatos donde se pidió
      Dado que compongo la plantilla HTML con los bloques "header, indice, contenido, formatos"
      Entonces la plantilla ordena "$if(toc)$, $if(formats)$"

    Escenario: Header y footer se quedan en sus anclas aunque se reordenen
      Dado que compongo la plantilla HTML con los bloques "contenido, footer, header, indice"
      # El contenido va antes que el índice porque así se configuró; el header
      # sigue delante de todo y el footer detrás de todo.
      Entonces la plantilla ordena "id=\"card-identity\", id=\"card-document\", id=\"card-identity-footer\""
      Y la plantilla ordena "id=\"card-document\", $if(toc)$"

  Regla de negocio: El masonry envuelve todas las tarjetas menos el cuerpo

    # #2483, #2488. En una colección el body va al nivel del masonry porque
    # cada miembro es su propia tarjeta; en un documento normal va dentro del
    # `<article>`.

    Escenario: En una colección el body no va dentro del article
      Dado que la plantilla HTML se compone para "collection"
      # Las tarjetas de cada file son del masonry, no del article.
      Entonces la plantilla dice "$body$"
      Y la plantilla no dice "<article"
      Y la plantilla no dice "$if(collection)$"

    Escenario: En un documento normal el body sí va dentro del article
      Dado que la plantilla HTML se compone para "file"
      Entonces la plantilla dice "<article"
      Y la plantilla dice "$body$"
      Y la plantilla no dice "$if(collection)$"

    Escenario: Una creadora también lleva su article
      Dado que la plantilla HTML se compone para "creator"
      Entonces la plantilla dice "<article"
      Y la plantilla no dice "$if(collection)$"

  Regla de negocio: El header abre el masonry y el footer lo cierra

    # #2487. Con `columns` de CSS, una tarjeta partida entre columnas se parte
    # a la mitad. `break-inside-avoid` lo evita; el footer, por ser el último,
    # no lleva `pb-6` porque no hay nada debajo.

    Escenario: Header y footer son tarjetas del masonry
      Dado que la plantilla HTML se compone para "file"
      Entonces el masonry trae "id=\"card-identity\""
      Y el masonry trae "id=\"card-identity-footer\""
      Y el masonry trae "$doc-chip$"
      Y la plantilla dice "<main class=\"container mx-auto columns-1 lg:columns-2 2xl:columns-3 gap-6"
      Y la plantilla dice "<div id=\"card-identity\" class=\"break-inside-avoid pb-6\">"
      Y la plantilla dice "<div id=\"card-identity-footer\" class=\"break-inside-avoid\">"
