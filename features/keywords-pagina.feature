# language: es
Característica: la página por defecto de palabras clave

  Como quien explora los temas del sitio
  Quiero una página con todas las palabras clave
  Para llegar a los contenidos desde un solo lugar

  Regla de negocio: keyword.html existe desde dos palabras clave

    Escenario: Con dos palabras clave aparece la página y el enlace del menú
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y el proyecto produce html
      Y que el archivo "ensayo.md" tiene este contenido
        """
        ---
        title: Ensayo
        keywords: [zeta, alfa]
        ---

        Cuerpo del ensayo.
        """
      Y que el archivo "otro.md" tiene este contenido
        """
        ---
        title: Otro
        keywords: [alfa]
        ---

        Otro cuerpo.
        """
      Y que el archivo "menu.md" tiene este contenido
        """
        ---
        type: menu
        title: Menú
        links:
          - name: Inicio
            url: ./index.html
        ---
        """
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/keyword.html" existe
      Y el archivo "dist/files/keyword.html" dice "id=\"card-document\""
      Y el archivo "dist/files/keyword.html" dice ">Palabras clave</h2>"
      Y el archivo "dist/files/keyword.html" dice "<ul>"
      Y el archivo "dist/files/keyword.html" dice ">alfa</a>"
      Y el archivo "dist/files/keyword.html" dice ">zeta</a>"
      Y el archivo "dist/files/keyword.html" pone ">alfa</a>" antes que ">zeta</a>"
      Y el archivo "dist/files/menu.html" dice "href=\"./keyword.html\""
      Y el chip "Palabras clave" del HTML de "ensayo.html" enlaza a "./keyword.html"
      Y el chip "Palabra clave" del HTML de "keywords/alfa.html" enlaza a "./../keyword.html"

    Escenario: La tarjeta de palabras clave no repite el nombre del sitio
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y el proyecto produce html
      Y que el archivo "ensayo.md" tiene este contenido
        """
        ---
        title: Ensayo
        keywords: [zeta, alfa]
        ---

        Cuerpo del ensayo.
        """
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el slot "sidebar" del archivo "dist/files/index.html" no contiene ">iteraciones</span>"

    Escenario: Con una sola palabra clave no hay página ni enlace
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y el proyecto produce html
      Y que el archivo "ensayo.md" tiene este contenido
        """
        ---
        title: Ensayo
        keywords: [unica]
        ---

        Cuerpo del ensayo.
        """
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/keyword.html" no existe
      Y el chip "Palabras clave" del HTML de "ensayo.html" no es un enlace
