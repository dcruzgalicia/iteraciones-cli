# language: es
Característica: las tarjetas de textos y colecciones en la página de la autora

  Como quien visita la página de una autora
  Quiero ver una tarjeta por cada texto y colección donde participa
  Para explorar su obra sin una lista de enlaces suelta

  Regla de negocio: La tarjeta «Textos» se sustituye por tarjetas

    Escenario: Cada texto y colección tiene su tarjeta después de la bio
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
      Y que el archivo "texto-1.md" tiene este contenido
        """
        ---
        title: Texto 1
        date: 2026-01-01
        creator: Autora A
        ---

        Cuerpo del texto 1.
        """
      Y que el archivo "texto-2.md" tiene este contenido
        """
        ---
        title: Texto 2
        date: 2026-03-01
        collectionCreator: Autora A
        ---

        Cuerpo del texto 2.
        """
      Y que el archivo "coleccion.md" tiene este contenido
        """
        ---
        title: Colección de Autora A
        type: collection
        date: 2026-02-01
        collectionCreator: Autora A
        files:
          - texto-1.md
        ---
        """
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/autora-a.html" no dice ">Textos<"
      Y el archivo "dist/files/autora-a.html" pone "Bio de Autora A." antes que "Texto 2"
      Y las tarjetas de "dist/files/autora-a.html" son hermanas de la bio
      Y el archivo "dist/files/autora-a.html" dice "Leer texto completo →"
      Y el archivo "dist/files/autora-a.html" dice "Ver colección completa →"
      Y el archivo "dist/files/autora-a.html" dice ">Colección</a>"
      Y el archivo "dist/files/autora-a.html" contiene 1 veces "Texto 1"
      Y el archivo "dist/files/autora-a.html" contiene 1 veces "Texto 2"

  Regla de negocio: Lo más reciente va primero

    Escenario: Las tarjetas se ordenan por date descendente y las sin fecha al final
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
      Y que el archivo "texto-viejo.md" tiene este contenido
        """
        ---
        title: Texto viejo
        date: 2026-01-01
        creator: Autora A
        ---

        Cuerpo viejo.
        """
      Y que el archivo "texto-nuevo.md" tiene este contenido
        """
        ---
        title: Texto nuevo
        date: 2026-03-01
        creator: Autora A
        ---

        Cuerpo nuevo.
        """
      Y que el archivo "texto-sin-fecha.md" tiene este contenido
        """
        ---
        title: Texto sin fecha
        creator: Autora A
        ---

        Cuerpo sin fecha.
        """
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/autora-a.html" pone "Texto nuevo" antes que "Texto viejo"
      Y el archivo "dist/files/autora-a.html" pone "Texto viejo" antes que "Texto sin fecha"

  Regla de negocio: Las tarjetas se paginan como las listas

    Escenario: Con más tarjetas que pageSize se generan páginas hermanas
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y que el archivo "iteraciones.config.yaml" tiene este contenido
        """
        language: es-MX
        format:
          html:
            generate: true
            pageSize: 2
        """
      Y que el archivo "autora.md" tiene este contenido
        """
        ---
        type: creator
        name: Autora A
        ---

        Bio de Autora A.
        """
      Y que el archivo "texto-1.md" tiene este contenido
        """
        ---
        title: Texto 1
        date: 2026-01-01
        creator: Autora A
        ---

        Cuerpo 1.
        """
      Y que el archivo "texto-2.md" tiene este contenido
        """
        ---
        title: Texto 2
        date: 2026-02-01
        creator: Autora A
        ---

        Cuerpo 2.
        """
      Y que el archivo "texto-3.md" tiene este contenido
        """
        ---
        title: Texto 3
        date: 2026-03-01
        creator: Autora A
        ---

        Cuerpo 3.
        """
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/autora-a.html" existe
      Y el archivo "dist/files/autora-a-2.html" existe
      Y el archivo "dist/files/autora-a.html" dice "Bio de Autora A."
      Y el archivo "dist/files/autora-a.html" dice "Texto 3"
      Y el archivo "dist/files/autora-a.html" dice "Texto 2"
      Y el archivo "dist/files/autora-a.html" no dice "Texto 1"
      Y el archivo "dist/files/autora-a.html" dice "Siguiente →"
      Y el archivo "dist/files/autora-a-2.html" no dice "Bio de Autora A."
      Y el archivo "dist/files/autora-a-2.html" no dice "card-document"
      Y el archivo "dist/files/autora-a-2.html" dice "Texto 1"
      Y el archivo "dist/files/autora-a-2.html" dice "← Anterior"
      Y el archivo "dist/files/autora-a-2.html" no dice ">Textos<"

  Regla de negocio: Sin textos ni colecciones no hay tarjetas

    Escenario: La autora sin obra se queda con su bio
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
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/autora-a.html" dice "Bio de Autora A."
      Y el archivo "dist/files/autora-a.html" no dice ">Textos<"
      Y el archivo "dist/files/autora-a.html" no dice "Leer texto completo →"
      Y el archivo "dist/files/autora-a.html" no dice "Ver colección completa →"
