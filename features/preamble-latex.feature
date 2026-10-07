# language: es
Característica: el preámbulo LaTeX que se entrega al autor

  Como quien abre su PDF en un lector
  Quiero que el `.tex` que se compila tenga la portada, el índice y el colofón
  en su sitio, cada uno detrás de su condicional
  Para que pandoc no halle una variable que el documento no trae y no se pare

  # Tramo 4 de la migración. El grupo más grande de `preamble.test.ts`.

  Regla de negocio: La portada del documento

    # El `.tex` es un TEMPLATE de pandoc, no LaTeX plano: cada bloque que sólo
    # aplica a algunos documentos va entre `$if(...)$` y `$endif$`. Si la
    # variable no llega, pandoc se come el bloque entero.

    Escenario: La portada tiene los huecos de las variables de pandoc
      Dado que compongo el LaTeX del documento
      Entonces el LaTeX trae:
      """
      \title{$title$}
      """
      Y el LaTeX trae:
      """
      $if(subtitle)$
      \subtitle{$subtitle$}
      $endif$
      """
      Y el LaTeX trae:
      """
      \author{$for(creator)$\mbox{$creator$}$sep$ \and $endfor$}
      """
      Y el LaTeX trae:
      """
      \date{$date$}
      """
      Y el LaTeX trae:
      """
      \maketitle
      """

    Escenario: Las páginas de título internas llegan por su propio condicional
      Dado que compongo el LaTeX del documento
      Entonces el LaTeX trae:
      """
      $if(extratitle)$
      \extratitle{$extratitle$}
      $endif$
      """
      Y el LaTeX trae:
      """
      $if(frontispiece)$
      \frontispiece{$frontispiece$}
      $endif$
      """
      Y el LaTeX trae:
      """
      $if(dedication)$
      \dedication{$dedication$}
      $endif$
      """
      Y el LaTeX trae:
      """
      $if(uppertitleback)$
      \uppertitleback{$uppertitleback$}
      $endif$
      """
      Y el LaTeX trae:
      """
      $if(publishers)$
      \publishers{$publishers$}
      $endif$
      """

    Escenario: La imagen de portada sale junto al título y no antes
      Dado que compongo el LaTeX del documento
      Entonces el LaTeX pone esto antes:
      """
      \title{$title$}
      """
      Y esto va más adelante:
      """
      \titleimage{$titleImage$}
      """

  Regla de negocio: Los bloques condicionales del template

    # Los saltos de línea son parte del contrato: pandoc compara el bloque
    # completo, y un `\n` de más o de menos deja la variable fuera del `$if`.

    Escenario: El aire post-portada sólo va con párrafo normal
      Dado que compongo el LaTeX del documento
      Entonces el LaTeX trae:
      """
      $if(skip-paragraph-space)$
      $else$
      \vspace*{2\baselineskip}
      """
      Y el LaTeX no trae:
      """
      \pagestyle{empty}
      """

    Escenario: El índice es condicional a que el documento tenga entradas
      Dado que compongo el LaTeX del documento
      Entonces el LaTeX trae:
      """
      $if(has-toc-entries)$
      \tableofcontents
      $endif$
      """
      Y el LaTeX no trae:
      """
      \lhead{empty}
      """

    Escenario: Sin índice no hay `\tableofcontents` en el LaTeX
      Dado que compongo el LaTeX sin índice
      Entonces el LaTeX no trae:
      """
      \tableofcontents
      """

    Escenario: La intervención va sin folio y su bloque tiene que ganar
      Dado que compongo el LaTeX del documento
      Entonces el LaTeX trae:
      """
      $if(intervention)$
      $elseif(page-number-command)$
      $page-number-command$
      $endif$
      """
      Y el LaTeX no trae:
      """
      \pagestyle{headings}
      """

    Escenario: El comando de página va dentro del mismo `else` que el aire post-portada
      Dado que compongo el LaTeX del documento
      # No basta con que los dos bloques existan: tienen que ir en el MISMO
      # `$else$`. Si el comando de página cayera fuera, saldría también en las
      # páginas de título internas, que no llevan folio.
      Entonces el LaTeX trae:
      """
      $if(skip-paragraph-space)$
      $else$
      \vspace*{2\baselineskip}
      $if(intervention)$
      $elseif(page-number-command)$
      $page-number-command$
      $endif$
      $endif$
      """
      Y el LaTeX no trae:
      """
      \pagestyle{empty}
      """
      Y el LaTeX no trae:
      """
      \pagestyle{headings}
      """

    Escenario: El colofón es la última página del documento
      Dado que compongo el LaTeX del documento
      # Si el colofón saliera antes de `$body$`, el autor vería su crédito en la
      # primera y las referencias al final sin él.
      Entonces el LaTeX pone esto antes:
      """
      $body$
      """
      Y esto va más adelante:
      """
      \colophonpage
      """
      Y el LaTeX termina con:
      """
      \end{document}
      """

    Escenario: El cuerpo del autor queda entre dos líneas en blanco
      Dado que compongo el LaTeX del documento
      # Sin las líneas en blanco, el primer párrafo del autor hereda el
      # `\parindent` del preámbulo y el PDF sale con la sangría corrida.
      Entonces el $body$ queda entre dos líneas en blanco

    Escenario: La biblatexografía escapa el % y deja el _ quieto
      Dado que compongo el LaTeX con una bibliografía de nombre awkward
      # El `%` abre un comentario en LaTeX y trunca la ruta. El `_` NO es un
      # subíndice dentro de una ruta: escaparlo rompería el archivo.
      Entonces el LaTeX escapa el % de la bibliografía y deja el _ quieto