Característica: el build exige las herramientas necesarias

  Como quien publica desde una máquina nueva
  Quiero que el build falle antes de procesar si falta una herramienta obligatoria
  Para no enterarme a mitad del build

  Regla de negocio: Pandoc e ImageMagick siempre son obligatorios

    Escenario: Sin pandoc el build falla antes de procesar
      Dado que la raíz del proyecto está vacía
      Y el proyecto produce html
      Y que el archivo "texto.md" tiene este contenido
        """
        ---
        title: Texto
        ---

        Contenido.
        """
      Cuando hago un build sin "pandoc"
      Entonces el comando termina con el código de salida 1
      Y el error dice "pandoc"

    Escenario: Sin ImageMagick el build falla antes de procesar
      Dado que la raíz del proyecto está vacía
      Y el proyecto produce html
      Y que el archivo "texto.md" tiene este contenido
        """
        ---
        title: Texto
        ---

        Contenido.
        """
      Cuando hago un build sin "magick"
      Entonces el comando termina con el código de salida 1
      Y el error dice "ImageMagick"

  Regla de negocio: PDF exige LaTeX

    Escenario: Sin latexmk el build de PDF falla
      Dado que la raíz del proyecto está vacía
      Y que el archivo "iteraciones.config.yaml" tiene este contenido
        """
        language: es-MX
        format:
          pdf:
            generate: true
        """
      Y que el archivo "texto.md" tiene este contenido
        """
        ---
        title: Texto
        ---

        Contenido.
        """
      Cuando hago un build sin "latexmk"
      Entonces el comando termina con el código de salida 1
      Y el error dice "LaTeX"

  Regla de negocio: la bibliografía exige biber

    Escenario: Sin biber el build de PDF con bibliografía falla
      Dado que la raíz del proyecto está vacía
      Y que el archivo "iteraciones.config.yaml" tiene este contenido
        """
        language: es-MX
        format:
          pdf:
            generate: true
        """
      Y que el archivo "refs.bib" tiene este contenido
        """
        @book{ejemplo, title={Ejemplo}}
        """
      Y que el archivo "texto.md" tiene este contenido
        """
        ---
        title: Texto
        ---

        Contenido.
        """
      Cuando hago un build sin "biber"
      Entonces el comando termina con el código de salida 1
      Y el error dice "biber"

  Regla de negocio: las portadas PDF exigen poppler

    Escenario: Sin pdftoppm el build de PDF con portada falla
      Dado que la raíz del proyecto está vacía
      Y que el archivo "iteraciones.config.yaml" tiene este contenido
        """
        language: es-MX
        format:
          pdf:
            generate: true
        """
      Y que el archivo "texto.md" tiene este contenido
        """
        ---
        title: Texto
        coverImage: true
        ---

        Contenido.
        """
      Cuando hago un build sin "pdftoppm"
      Entonces el comando termina con el código de salida 1
      Y el error dice "poppler"
