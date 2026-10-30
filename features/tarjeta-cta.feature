# language: es
Característica: el CTA de las tarjetas y la etiqueta Colaboradora

  Como quien navega el sitio
  Quiero que cada tarjeta diga qué hay al otro lado y que el botón se vea como botón
  Para no adivinar a dónde lleva un enlace

  Regla de negocio: Cada tipo tiene su propio texto de CTA

    Escenario: Las tarjetas de todos los tipos dicen qué hay al otro lado
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y el proyecto produce html
      Y que el archivo "texto.md" tiene este contenido
        """
        ---
        title: Un texto
        date: 2026-09-11
        creator: Autora A
        ---

        Cuerpo del texto.
        """
      Y que el archivo "antologia.md" tiene este contenido
        """
        ---
        title: Antología
        type: collection
        files:
          - texto.md
        ---
        """
      Y que el archivo "autora.md" tiene este contenido
        """
        ---
        type: creator
        name: Autora A
        ---

        Bio de Autora A.
        """
      Y que el archivo "mi-lista.md" tiene este contenido
        """
        ---
        title: Mi lista
        type: list
        files:
          - texto.md
        ---
        """
      Y que el archivo "anuncio.md" tiene este contenido
        """
        ---
        type: announcement
        title: Tercera convocatoria
        date: 2026-09-12
        creator: Histórikas
        placement: top
        ---

        Este es el anuncio.
        """
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/index.html" dice "Leer texto completo →"
      Y el archivo "dist/files/index.html" dice "Ver colección completa →"
      Y el archivo "dist/files/index.html" dice "Ver página de la creadora →"
      Y el archivo "dist/files/index.html" dice "Ver lista completa →"
      Y el archivo "dist/files/index.html" dice "Leer anuncio →"
      Y el archivo "dist/files/index.html" dice ">Anuncio<"

  Regla de negocio: El CTA es un botón, no un enlace de texto

    Escenario: El CTA lleva las clases del botón y el foco visible
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y el proyecto produce html
      Y que el archivo "texto.md" tiene este contenido
        """
        ---
        title: Un texto
        date: 2026-09-11
        creator: Autora A
        ---

        Cuerpo del texto.
        """
      Cuando hago un build del proyecto
      Entonces el archivo "dist/files/index.html" dice "inline-flex items-center gap-2 rounded-full bg-accent-600 px-4 py-2 text-sm font-semibold"
      Y el archivo "dist/files/index.html" dice "focus-visible:outline"

    Escenario: El «Ver más» del menú usa el mismo botón que las tarjetas
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
        ---
        """
      Cuando hago un build del proyecto
      Entonces el archivo "dist/files/index.html" dice "href=\"./menu.html\" class=\"inline-flex items-center gap-2 rounded-full bg-accent-600"

  Regla de negocio: En lo visible se dice Colaboradora, pero el type sigue siendo creator

    Escenario: El chip y la lista dicen Colaboradora y creadora.html sigue existiendo
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y el proyecto produce html
      Y que el archivo "autora.md" tiene este contenido
        """
        ---
        type: creator
        name: Autora A
        ---

        Bio de Autora A.
        """
      Cuando hago un build del proyecto
      Entonces el archivo "dist/files/index.html" dice ">Colaboradora</a>"
      Y el archivo "dist/files/index.html" dice "href=\"./creadora.html\""
      Y el archivo "dist/files/creadora.html" existe
      Y el archivo "dist/files/creadora.html" dice "Colaboradoras"

    Escenario: El CTA de la creadora habla de la persona, no del type
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y el proyecto produce html
      Y que el archivo "autora.md" tiene este contenido
        """
        ---
        type: creator
        name: Autora A
        ---

        Bio de Autora A.
        """
      Cuando hago un build del proyecto
      Entonces el archivo "dist/files/creadora.html" dice "Ver página de la creadora →"
