# language: es
Característica: el maketitle y las páginas de título

  Como quien mira la portada de su libro
  Quiero que la dedicatoria vaya centrada y el subtítulo no rompa la compilación
  Para no tener que abrir el LaTeX para saber por qué la portada salió mal

  # Tramo 21 de la migración. 12 de los 29 casos que quedaban de
  # `preamble.test.ts`.

  # El maketitle de KOMA es un bloque de doscientas líneas. Cada ajuste de aire,
  # de ancho y de centrado vive en una línea concreta, y cambiarla cambia la
  # portada. Los pasos hablan de "la dedicatoria va centrada" y no de la línea.
  #
  # El filtro lleva comentarios `%` que explican la decisión. Un `Then` que
  # busque un fragmento en el texto completo fallaría por el comentario que lo
  # explica, así que hay un paso que mira el CÓDIGO, sin comentarios.

  Regla de negocio: Los saltos de página son propios, no los de KOMA

    # Regresión: `\next@tpage` ejecuta `\setparsizes{0}{0}`, que deja
    # `\parindent` a 0 de forma global y el cuerpo pierde la indentación. La
    # portada se veía bien y el texto no.

    Escenario: El maketitle usa los saltos propios
      Dado que la raíz del proyecto está vacía
      Cuando miro el filtro "28-titlepages"
      Cuando miro además el filtro "19-maketitle"
      Entonces el filtro trae:
      """
      \newcommand{\titlepage@next}
      """
      Y el filtro trae:
      """
      \newcommand{\titlepage@nextdouble}
      """
      Y el código del filtro no trae:
      """
      \next@tpage
      """
      Y el código del filtro no trae:
      """
      \next@tdpage
      """

  Regla de negocio: La dedicatoria va centrada y con su aire

    Escenario: La dedicatoria lleva aire fijo y va centrada
      Dado que la raíz del proyecto está vacía
      Cuando miro el filtro "19-maketitle"
      # `\vspace*{5\baselineskip}` antes del contenido: sin él la dedicatoria
      # pega contra el título.
      Entonces el filtro trae:
      """
      \vspace*{5\baselineskip}
      """
      Y el filtro trae:
      """
      {\@dedication\par}
      """
      Y el filtro trae:
      """
      \vspace*{7\baselineskip}
      """

    # El titleback se imprime también en oneside: envolverlo en `\if@twoside`
    # lo escondía en los libros de una cara.
    Escenario: El titleback sale en ambos modos y el verso en blanco es condicional
      Dado que la raíz del proyecto está vacía
      Cuando miro el filtro "19-maketitle"
      Entonces el filtro trae:
      """
      \@tempswatrue
      """
      Y el filtro no trae:
      """
      \if@twoside\n  \@tempswatrue
      """
      Y el filtro trae:
      """
      \if@twoside\if@openright
      """
      Y el filtro trae:
      """
      \null\clearpage
      """

  Regla de negocio: El subtítulo largo no rompe la compilación

    # KOMA define `\subtitle` con `\newcommand*` (no-long): una línea en blanco
    # en el argumento rompía la compilación. Y `\parindent\z@` evita la
    # indentación del primer párrafo, que `\noindent` no cubre.

    Escenario: El subtítulo acepta párrafos y sin indentación
      Dado que la raíz del proyecto está vacía
      Cuando miro el filtro "19-maketitle"
      Entonces el filtro trae:
      """
      \renewcommand{\subtitle}[1]{\gdef\@subtitle{%
      """
      Y el filtro trae:
      """
      \parindent\z@\@subtitle\par
      """

  Regla de negocio: La imagen de portada tiene su ancho máximo

    # `titleImage` afecta a la portada y no crea un extratitle: si lo creara,
    # la imagen saldría dos veces.
    Escenario: La imagen de portada se renderiza con su ancho y no crea extratitle
      Dado que la raíz del proyecto está vacía
      Cuando miro el filtro "19-maketitle"
      Entonces el filtro trae:
      """
      \usepackage{graphicx}
      """
      Y el filtro trae:
      """
      \newcommand{\titleimagerender}[2][0.8\textwidth]{%
      """
      Y el filtro trae:
      """
      \ifdim\wd\titleimagebox>#1
      """
      Y el filtro trae:
      """
      width=#1,keepaspectratio
      """
      Y el filtro no trae:
      """
      \titleimagerender[\extratitlewidth]{\@titleimage}
      """

  Regla de negocio: El colofón no hereda las imágenes automáticas

    Escenario: El colofón no trae titleImage ni publisherImage
      Dado que la raíz del proyecto está vacía
      Cuando miro el filtro "28-titlepages"
      # El colofón es la última página: si heredara las imágenes de la portada,
      # el autor vería su crédito con la portada repetida.
      Entonces el filtro no trae:
      """
      \@titleimage
      """

  Regla de negocio: La página en blanco y la cortesía son autónomas

    # `titlepageblanks` acoplaba la página en blanco a la rama de extratitle:
    # sin extratitle no había página en blanco, y con dos había una de más.
    Escenario: La página en blanko y la cortesía no dependen del extratitle
      Dado que la raíz del proyecto está vacía
      Cuando miro el filtro "19-maketitle"
      Entonces el filtro trae:
      """
      \newcommand{\titlepage@blankpage}{%
      """
      Y el filtro trae:
      """
      \ifcourtepage
      """
      Y el filtro no trae:
      """
      titlepageblanks
      """
      Y el filtro trae:
      """
      \titlepageguardstrue
      """
      Y el filtro trae "\titlepageguardstrue" 1 vez

  Regla de negocio: Los bloques de la portada comparten márgenes y estilo

    Escenario: El extratitle va centrado y la dedicatoria justificada
      Dado que la raíz del proyecto está vacía
      Cuando miro el filtro "19-maketitle"
      Entonces el filtro trae:
      """
      \newcommand*{\extratitlewidth}{0.75\textwidth}
      """
      Y el filtro no trae:
      """
      \dedicationwidth
      """
      Y el filtro trae:
      """
      \newcommand{\titlepageblock}[4]{%
      """
      Y el filtro trae:
      """
      \leftmargin=#1
      """
      Y el filtro trae:
      """
      {\centering}%
      """

  Regla de negocio: El LaTeX no lleva caracteres de control

    # Un backspace o un tab en el LaTeX se come el carácter de delante y la
    # portada sale con una palabra menos. No hay forma de verlo en el PDF.

    Escenario: El LaTeX compuesto no lleva backspace ni tab
      Dado que la raíz del proyecto está vacía
      Y que compongo el LaTeX del documento
      Entonces el LaTeX no lleva caracteres de control

  Regla de negocio: El condicional de babel sale del metadata

    Escenario: El idioma del PDF sale del metadata babel-lang
      Dado que la raíz del proyecto está vacía
      Cuando compongo el LaTeX con el filtro "05-language"
      Entonces el LaTeX trae:
      """
      $if(babel-lang)$
      \usepackage[$babel-lang$]{babel}
      $else$
      """
      Y el LaTeX trae:
      """
      $endif$
      """
