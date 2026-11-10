# language: es
Característica: el menú del sitio

  Como quien navega el sitio
  Quiero una tarjeta de menú con los primeros enlaces y una página con todos
  Para llegar a las secciones sin buscar en las tarjetas

  Regla de negocio: El header lleva al menú y el footer muestra cinco enlaces

    Escenario: Con más de diez enlaces el footer recorta
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
          - name: Mastodon
            url: https://mastodon.social/@iteraciones
          - name: Instagram
            url: https://instagram.com/x
          - name: YouTube
            url: https://youtube.com/x
          - name: TikTok
            url: https://tiktok.com/@x
          - name: Bluesky
            url: https://bsky.app/profile/x
          - name: Threads
            url: https://threads.net/@x
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
      Y el archivo "dist/files/index.html" dice ">Autoras<"
      Y el archivo "dist/files/index.html" dice "Facebook"
      Y el archivo "dist/files/index.html" dice "Mastodon"
      Y el archivo "dist/files/index.html" dice "TikTok"
      Y el archivo "dist/files/index.html" no dice "Bluesky"
      Y el archivo "dist/files/index.html" no dice "Threads"
      Y el archivo "dist/files/menu.html" dice ">Menú</h2>"
      Y el archivo "dist/files/index.html" no dice "Más →"

    Escenario: El botón del menú va después de la identidad y antes de Redes
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
      Y el archivo "dist/files/index.html" pone "aria-label=\"Menú\"" antes que "aria-label=\"Redes\""
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
      Entonces el archivo "dist/files/index.html" dice "<a href=\"./index.html\" class=\"inline-flex h-7 items-center gap-2 rounded-full border border-accent-500/40 bg-transparent px-2.5 text-[11px] font-semibold text-accent-800 no-underline transition-colors duration-200 hover:border-accent-500 hover:bg-accent-500/10 sm:px-3 sm:text-xs lg:px-3.5 lg:text-sm dark:border-accent-400/40 dark:bg-transparent dark:text-accent-300 dark:hover:bg-accent-500/10\">Inicio</a>"
      Y el archivo "dist/files/index.html" dice "href=\"https://www.facebook.com/Historikasmx\""
      Y el archivo "dist/files/index.html" dice "target=\"_blank\" rel=\"noopener noreferrer\""

    Escenario: Un menú sin title sigue generando la página
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y el proyecto produce html
      Y que el archivo "menu.md" tiene este contenido
        """
        ---
        type: menu
        links:
          - name: Inicio
            url: ./index.html
        ---
        """
      Cuando hago un build del proyecto
      Entonces el archivo "dist/files/menu.html" existe
      Y el archivo "dist/files/index.html" dice ">Menú<"

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
