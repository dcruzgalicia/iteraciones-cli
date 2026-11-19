Característica: el fondo personalizado del sitio y de una página

  Como quien personaliza su sitio
  Quiero una imagen de fondo tenue
  Para reemplazar la retícula por defecto sin tocar las tarjetas

  Regla de negocio: El fondo del sitio se aplica a todas las páginas

    Escenario: Una página usa el fondo del sitio
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y el proyecto produce html
      Y existe la imagen "fondo.png"
      Y que el archivo "iteraciones.config.yaml" tiene este contenido
        """
        language: es-MX
        format:
          html:
            generate: true
            site:
              backgroundImage: ./fondo.png
        """
      Y que el archivo "texto.md" tiene este contenido
        """
        ---
        title: Texto
        ---

        Cuerpo.
        """
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/texto.html" dice "sitio--fondo"
      Y el archivo "dist/files/texto.html" dice "site-background.webp"
      Y el archivo "dist/files/texto.html" dice "--sitio-fondo"

    Escenario: La página puede sobrescribir el fondo del sitio
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y el proyecto produce html
      Y existe la imagen "fondo.png"
      Y existe la imagen "textos/pagina.png"
      Y que el archivo "iteraciones.config.yaml" tiene este contenido
        """
        language: es-MX
        format:
          html:
            generate: true
            site:
              backgroundImage: ./fondo.png
        """
      Y que el archivo "textos/texto.md" tiene este contenido
        """
        ---
        title: Texto
        backgroundImage: ./pagina.png
        ---

        Cuerpo.
        """
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/textos/texto.html" dice "sitio--fondo"
      Y el archivo "dist/files/textos/texto.html" dice "-pagina.webp"
      Y el archivo "dist/files/textos/texto.html" no dice "site-background.webp"

    Escenario: Sin fondo configurado se conserva la retícula
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y el proyecto produce html
      Y que el archivo "texto.md" tiene este contenido
        """
        ---
        title: Texto
        ---

        Cuerpo.
        """
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/texto.html" no dice "sitio--fondo"
      Y el archivo "dist/files/texto.html" no dice "--sitio-fondo"

    Escenario: Si el fondo no existe se avisa y no se aplica
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y el proyecto produce html
      Y que el archivo "iteraciones.config.yaml" tiene este contenido
        """
        language: es-MX
        format:
          html:
            generate: true
            site:
              backgroundImage: ./no-existe.png
        """
      Y que el archivo "texto.md" tiene este contenido
        """
        ---
        title: Texto
        ---

        Cuerpo.
        """
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y la salida dice "fondo no encontrado"
      Y el archivo "dist/files/texto.html" no dice "sitio--fondo"

  Regla de negocio: El fondo es solo para HTML

    Escenario: El LaTeX no usa el fondo del sitio
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y existe la imagen "fondo.png"
      Y que el archivo "iteraciones.config.yaml" tiene este contenido
        """
        language: es-MX
        format:
          latex:
            generate: true
          html:
            generate: true
            site:
              backgroundImage: ./fondo.png
        """
      Y que el archivo "texto.md" tiene este contenido
        """
        ---
        title: Texto
        ---

        Cuerpo.
        """
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/texto.tex" no dice "backgroundImage"
      Y el archivo "dist/files/texto.tex" no dice "site-background"
