# language: es
Característica: Los composers definen el contrato de argumentos sobre fixtures
  Como quien mantiene la frontera con pandoc
  Quiero ver exactamente qué argumentos y en qué orden salen hacia pandoc
  Para poder cambiar el compositor sin miedo de romper la conversión

  @spy-composers
  Escenario: LaTeX pasa a pandoc el contrato completo de argumentos (#2031)
    Dado el fixture de salida LaTeX de pandoc
    Cuando convierto el markdown a LaTeX con la bibliografía "refs/biblio.bib"
    Entonces el LaTeX es el fixture y no hay imágenes procesadas
    Y la llamada a pandoc lleva el contrato completo de LaTeX

  @spy-composers
  Escenario: El orden de --lua-filter es semantic, luego user, flags y latex (#2031)
    Dado el fixture de salida LaTeX de pandoc
    Cuando convierto el markdown a LaTeX con los cuatro grupos de filtros
    Entonces los filtros lua salen en el orden semantic, user, flags y latex

  @spy-composers
  Escenario: Una portada inexistente falla antes de invocar pandoc (#2031)
    Dado el fixture de salida LaTeX de pandoc
    Cuando convierto el markdown a LaTeX con una portada que no existe
    Entonces la conversión falla con un error de build
    Y pandoc no fue invocado

  @spy-composers
  Escenario: El HTML con referencias recibe la tarjeta y pierde el h1 sintético (#2031)
    Dado el fixture de salida HTML con referencias de pandoc
    Cuando convierto el markdown a una página HTML con tarjeta de referencias
    Entonces el índice ya no enlaza al encabezado de referencias
    Y el marcador se sustituye por la tarjeta con la lista extraída
    Y el encabezado sintético no queda en el artículo
    Y la llamada a pandoc pide HTML5 con el idioma del sitio y citas enlazadas

  @spy-composers
  Escenario: El HTML sin bloque de referencias queda intacto
    Dado el fixture de salida HTML sin referencias de pandoc
    Cuando convierto el markdown a una página HTML con tarjeta de referencias
    Entonces el HTML es el fixture sin post-procesar

  @spy-composers
  Escenario: citeproc sólo con bibliografía efectiva
    Dado el fixture de salida HTML sin referencias de pandoc
    Cuando convierto el markdown a una página HTML con bibliografía y estilo APA
    Y lo convierto de nuevo sin opciones de bibliografía
    Entonces la primera llamada lleva citeproc, la bibliografía y el estilo APA
    Y la segunda llamada no lleva citeproc

  Regla de negocio: La distribución de LaTeX es portátil (#2084/#2450)
    Las rutas absolutas de las imágenes procesadas no sobreviven a la
    distribución: el .tex que va a dist debe apuntar a assets/images.

    Escenario: Apunta a assets/images y desambigua los basenames duplicados
      Cuando distribuyo las imágenes "/a/img/cover.jpg", "/b/img/cover.jpg" y "/b/img/back.png"
      Entonces la distribución es:
        | origen               | destino                 |
        | /a/img/cover.jpg     | assets/images/cover.jpg |
        | /b/img/cover.jpg     | assets/images/cover-2.jpg |
        | /b/img/back.png      | assets/images/back.png  |

    Escenario: Sin procesadas la distribución es vacía y rewrite no toca el .tex
      Cuando distribuyo ninguna imagen procesada
      Entonces la distribución está vacía
      Y reescribir "\includegraphics{original.jpg}" lo deja igual

    Escenario: Rewrite sustituye las rutas absolutas por las de assets/images
      Cuando distribuyo la imagen procesada "/proy/dist/files/assets/images/ensayo-portada-cmyk.jpg"
      Y reescribo el .tex que la referencia dos veces
      Entonces las dos referencias quedan dentro de la carpeta de imágenes
