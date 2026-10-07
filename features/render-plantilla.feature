# language: es
Característica: la plantilla HTML que se entrega a pandoc

  Como quien abre el resultado en el navegador
  Quiero que las tarjetas salgan en un orden que se pueda recorrer
  Para que la portada, el índice, la descarga y el contenido no se mezclen

  Regla de negocio: El orden por defecto de las tarjetas

    Escenario: Cada tarjeta va detrás de la anterior
      Dado que la plantilla HTML se compone para "file"
      Entonces la plantilla ordena "$doc-chip$, $if(toc)$, $if(formats)$, $if(has-references)$"
      Y la plantilla dice "$if(home-href)$"

    Escenario: La tarjeta de referencias es condicional
      Dado que la plantilla HTML se compone para "file"
      Entonces la plantilla dice "$if(has-references)$"
      Y la plantilla dice "<div id=\"block-referencias\"></div>"

    Escenario: La tarjeta de formatos es un flag y un hueco por formato
      Dado que la plantilla HTML se compone para "file"
      Entonces la plantilla dice "$if(formats)$"
      Y la plantilla dice "$fmt-pdf$"
      Y la plantilla dice "$fmt-epub$"
      Y la plantilla no dice "$formats$"

  Regla de negocio: Reordenar bloques mueve las del medio, no el header ni el footer

    Escenario: Una lista explícita pone los formatos donde se pidió
      Dado que compongo la plantilla HTML con los bloques "header, indice, contenido, formatos"
      Entonces la plantilla ordena "$if(toc)$, $if(formats)$"

    Escenario: Header y footer se quedan en sus anclas aunque se reordenen
      Dado que compongo la plantilla HTML con los bloques "contenido, footer, header, indice"
      Entonces la plantilla ordena "id=\"card-identity\", id=\"card-document\", id=\"card-identity-footer\""
      Y la plantilla ordena "id=\"card-document\", $if(toc)$"

  Regla de negocio: El masonry envuelve todas las tarjetas menos el cuerpo

    Escenario: En una colección el body no va dentro del article
      Dado que la plantilla HTML se compone para "collection"
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

    Escenario: Header y footer son tarjetas del masonry
      Dado que la plantilla HTML se compone para "file"
      Entonces el masonry trae "id=\"card-identity\""
      Y el masonry trae "id=\"card-identity-footer\""
      Y el masonry trae "$doc-chip$"
      Y la plantilla dice "<main class=\"container mx-auto columns-1 lg:columns-2 2xl:columns-3 gap-6"
      Y la plantilla dice "<div id=\"card-identity\" class=\"break-inside-avoid pb-6\">"
      Y la plantilla dice "<div id=\"card-identity-footer\" class=\"break-inside-avoid\">"
