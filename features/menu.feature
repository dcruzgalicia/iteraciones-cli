# language: es
Característica: el menú del sitio

  Como quien navega el sitio
  Quiero una tarjeta de menú con los primeros enlaces y una página con todos
  Para llegar a las secciones sin buscar en las tarjetas

  Regla de negocio: La tarjeta muestra tres enlaces y «Ver más»

    Escenario: Con cinco enlaces la tarjeta muestra tres y «Ver más»
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y el proyecto produce html
      Y que el archivo "menu.md" tiene este contenido
        """
        ---
        type: menu
        title: Menú
        links:
          - name: Inicio
            url: ./index.html
          - name: Libro
            url: ./libro.html
          - name: Convocatorias
            url: ./convocatorias.html
          - name: Autoras
            url: ./creadora.html
          - name: Facebook
            url: https://www.facebook.com/Historikasmx
        ---
        """
      Y que el archivo "libro.md" tiene este contenido
        """
        ---
        title: Libro
        ---

        Cuerpo.
        """
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/menu.html" existe
      Y el archivo "dist/files/index.html" dice ">Menú<"
      Y el archivo "dist/files/index.html" dice "Inicio"
      Y el archivo "dist/files/index.html" dice "Libro"
      Y el archivo "dist/files/index.html" dice "Convocatorias"
      Y el archivo "dist/files/index.html" no dice ">Autoras<"
      Y el archivo "dist/files/index.html" dice "Ver más →"

    Escenario: La tarjeta va después de la identidad y antes de Redes
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y el proyecto produce html
      Y que el archivo "menu.md" tiene este contenido
        """
        ---
        type: menu
        title: Menú
        links:
          - name: Inicio
            url: ./index.html
          - name: Libro
            url: ./libro.html
        ---
        """
      Y que el archivo "iteraciones.config.yaml" tiene este contenido
        """
        language: es-MX
        format:
          html:
            generate: true
            site:
              title: Historikas
              links:
                - name: Facebook
                  url: https://facebook.com/x
        """
      Cuando hago un build del proyecto
      Entonces el archivo "dist/files/index.html" pone "<div id=\"card-identity\"" antes que ">Menú<"
      Y el archivo "dist/files/index.html" pone ">Menú<" antes que ">Redes<"
      Y el archivo "dist/files/index.html" no dice "Ver más →"

    Escenario: Los enlaces externos abren en otra pestaña y los internos no
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y el proyecto produce html
      Y que el archivo "menu.md" tiene este contenido
        """
        ---
        type: menu
        title: Menú
        links:
          - name: Inicio
            url: ./index.html
          - name: Facebook
            url: https://www.facebook.com/Historikasmx
        ---
        """
      Cuando hago un build del proyecto
      Entonces el archivo "dist/files/index.html" dice "<a href=\"./index.html\" class=\"no-underline underline-offset-4 decoration-current/40 transition-colors duration-200 hover:underline hover:decoration-current\">Inicio</a>"
      Y el archivo "dist/files/index.html" dice "href=\"https://www.facebook.com/Historikasmx\""
      Y el archivo "dist/files/index.html" dice "target=\"_blank\" rel=\"noopener noreferrer\""

  Regla de negocio: Un solo menú por proyecto

    Escenario: Dos menús son un error claro
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y el proyecto produce html
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
      Y que el archivo "otro-menu.md" tiene este contenido
        """
        ---
        type: menu
        title: Otro menú
        links:
          - name: Inicio
            url: ./index.html
        ---
        """
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 1
      Y el error dice "solo puede haber un \"type: menu\""

  Regla de negocio: menu.html lista todos los enlaces

    Escenario: La página del menú trae los cinco
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y el proyecto produce html
      Y que el archivo "menu.md" tiene este contenido
        """
        ---
        type: menu
        title: Menú
        links:
          - name: Inicio
            url: ./index.html
          - name: Libro
            url: ./libro.html
          - name: Convocatorias
            url: ./convocatorias.html
          - name: Autoras
            url: ./creadora.html
          - name: Facebook
            url: https://www.facebook.com/Historikasmx
        ---
        """
      Cuando hago un build del proyecto
      Entonces el archivo "dist/files/menu.html" dice "Autoras"
      Y el archivo "dist/files/menu.html" dice "Facebook"
      Y el archivo "dist/files/menu.html" no dice "Ver más →"

  Regla de negocio: Sin menú nada cambia

    Escenario: Sin type menu no hay tarjeta
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y el proyecto produce html
      Cuando hago un build del proyecto
      Entonces el archivo "dist/files/index.html" no dice ">Menú<"
