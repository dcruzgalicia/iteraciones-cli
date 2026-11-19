Característica: la marca de agua de las portadas en las tarjetas de preview

  Como quien recorre listas y colecciones
  Quiero reconocer las tarjetas por su portada
  Para ubicar un texto sin abrirlo

  Regla de negocio: La portada se usa como fondo tenue

    Escenario: Un texto con portada en una colección lleva el fondo
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y el proyecto produce html
      Y existe la imagen "front.png"
      Y que el archivo "texto.md" tiene este contenido
        """
        ---
        title: Texto con portada
        frontCover: ./front.png
        ---

        Cuerpo.
        """
      Y que el archivo "antologia.md" tiene este contenido
        """
        ---
        title: Antología
        type: collection
        files:
          - texto.md
        ---

        Intro.
        """
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/antologia.html" dice "tarjeta--con-fondo"
      Y el archivo "dist/files/antologia.html" dice "tarjeta-fondo"
      Y el archivo "dist/files/antologia.html" dice "-front.webp"

    Escenario: frontCover gana sobre backCover
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y el proyecto produce html
      Y existe la imagen "front.png"
      Y existe la imagen "back.png"
      Y que el archivo "texto.md" tiene este contenido
        """
        ---
        title: Texto con dos portadas
        frontCover: ./front.png
        backCover: ./back.png
        ---

        Cuerpo.
        """
      Y que el archivo "antologia.md" tiene este contenido
        """
        ---
        title: Antología
        type: collection
        files:
          - texto.md
        ---

        Intro.
        """
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/antologia.html" dice "-front.webp"
      Y el archivo "dist/files/antologia.html" no dice "-back.webp"

    Escenario: Sin portadas la tarjeta no lleva fondo
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y el proyecto produce html
      Y que el archivo "texto.md" tiene este contenido
        """
        ---
        title: Texto sin portada
        ---

        Cuerpo.
        """
      Y que el archivo "antologia.md" tiene este contenido
        """
        ---
        title: Antología
        type: collection
        files:
          - texto.md
        ---

        Intro.
        """
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/antologia.html" no dice "tarjeta--con-fondo"

    Escenario: Las tarjetas de creadora no llevan marca de agua
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y el proyecto produce html
      Y existe la imagen "front.png"
      Y una creadora llamada "Ana García" con retrato "ana.jpg"
      Y que el archivo "autora.md" tiene este contenido
        """
        ---
        type: creator
        name: Otra Autora
        frontCover: ./front.png
        ---

        Semblanza.
        """
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/creadora.html" no dice "tarjeta--con-fondo"
