Característica: el span para insertar espacios duros

  Como quien escribe versos con sangría
  Quiero marcar los espacios duros sin que Markdown los convierta en código
  Para conservar la composición en todos los formatos

  Regla de negocio: []{n=N} inserta N espacios duros

    Escenario: En HTML inserta &nbsp; al inicio de línea y en prosa
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y el proyecto produce html
      Y que el archivo "poema.md" tiene este contenido
        """
        ---
        title: Poema
        ---

        ::: {.verse}
        []{n=4}verso con cuatro\
        []{n=12}verso con doce
        :::

        Texto con[]{n=2}dos espacios y[]{n=1}uno.
        """
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/poema.html" dice "&nbsp;&nbsp;&nbsp;&nbsp;verso con cuatro"
      Y el archivo "dist/files/poema.html" dice "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;verso con doce"
      Y el archivo "dist/files/poema.html" dice "&nbsp;&nbsp;dos espacios y&nbsp;uno."
      Y el archivo "dist/files/poema.html" no dice "<pre><code>"

    Escenario: En LaTeX inserta ~ y en markdown conserva el span
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y que el archivo "iteraciones.config.yaml" tiene este contenido
        """
        language: es-MX
        format:
          latex:
            generate: true
          markdown:
            generate: true
        """
      Y que el archivo "poema.md" tiene este contenido
        """
        ---
        title: Poema
        ---

        []{n=4}verso
        """
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/poema.tex" dice "~~~~verso"
      Y el archivo "dist/files/poema.md" dice "[]{n="

    Escenario: Un n inválido no inserta nada
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y el proyecto produce html
      Y que el archivo "poema.md" tiene este contenido
        """
        ---
        title: Poema
        ---

        []{n=0}sin espacios
        """
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/poema.html" dice "sin espacios"
      Y el archivo "dist/files/poema.html" no dice "<pre><code>"
