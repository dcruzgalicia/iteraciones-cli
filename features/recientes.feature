Característica: las tarjetas de entradas recientes del sidebar

  Como quien visita el sitio
  Quiero ver las cinco entradas más recientes en tarjetas
  Para seguir leyendo sin volver al índice

  Regla de negocio: Hay una tarjeta por entrada reciente

    Escenario: En una página de texto aparecen las cinco más recientes
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y el proyecto produce html
      Y que el archivo "texto-1.md" tiene este contenido
        """
        ---
        title: Texto 1
        date: 2026-02-01
        ---

        Cuerpo 1.
        """
      Y que el archivo "texto-2.md" tiene este contenido
        """
        ---
        title: Texto 2
        date: 2026-03-01
        ---

        Cuerpo 2.
        """
      Y que el archivo "texto-3.md" tiene este contenido
        """
        ---
        title: Texto 3
        date: 2026-04-01
        ---

        Cuerpo 3.
        """
      Y que el archivo "texto-4.md" tiene este contenido
        """
        ---
        title: Texto 4
        date: 2026-05-01
        ---

        Cuerpo 4.
        """
      Y que el archivo "texto-5.md" tiene este contenido
        """
        ---
        title: Texto 5
        date: 2026-06-01
        ---

        Cuerpo 5.
        """
      Y que el archivo "texto-6.md" tiene este contenido
        """
        ---
        title: Texto 6
        date: 2026-07-01
        ---

        Cuerpo 6.
        """
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/texto-6.html" contiene 5 veces ">Reciente</h2>"
      Y el archivo "dist/files/texto-6.html" no dice ">Recientes</h2>"
      Y el archivo "dist/files/texto-6.html" dice "Texto 6"
      Y el archivo "dist/files/texto-6.html" dice "Texto 5"
      Y el archivo "dist/files/texto-6.html" dice "Texto 4"
      Y el archivo "dist/files/texto-6.html" dice "Texto 3"
      Y el archivo "dist/files/texto-6.html" dice "Texto 2"
      Y el archivo "dist/files/texto-6.html" no dice "Texto 1"
      Y el archivo "dist/files/texto-6.html" dice "Leer texto completo →"

    Escenario: La lista por defecto de index no lleva tarjetas de recientes
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y el proyecto produce html
      Cuando hago un build del proyecto
      Entonces el archivo "dist/files/index.html" no dice ">Reciente</h2>"

    Escenario: El index del proyecto nunca aparece en recientes
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y el proyecto produce html
      Y que el archivo "texto-1.md" tiene este contenido
        """
        ---
        title: Texto 1
        date: 2026-02-01
        ---

        Cuerpo 1.
        """
      Y que el archivo "texto-2.md" tiene este contenido
        """
        ---
        title: Texto 2
        date: 2026-03-01
        ---

        Cuerpo 2.
        """
      Y que el archivo "texto-3.md" tiene este contenido
        """
        ---
        title: Texto 3
        date: 2026-04-01
        ---

        Cuerpo 3.
        """
      Y que el archivo "texto-4.md" tiene este contenido
        """
        ---
        title: Texto 4
        date: 2026-05-01
        ---

        Cuerpo 4.
        """
      Y que el archivo "texto-5.md" tiene este contenido
        """
        ---
        title: Texto 5
        date: 2026-06-01
        ---

        Cuerpo 5.
        """
      Y que el archivo "index.md" tiene este contenido
        """
        ---
        title: Portada del proyecto
        type: collection
        date: 2026-12-01
        files:
          - texto-1.md
        ---
        """
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/texto-5.html" contiene 5 veces ">Reciente</h2>"
      Y el archivo "dist/files/texto-5.html" dice "Texto 1"

    Escenario: Una colección reciente muestra su antologadora y su CTA
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y el proyecto produce html
      Y que el archivo "texto-1.md" tiene este contenido
        """
        ---
        title: Texto 1
        creator: Autora A
        date: 2026-02-01
        ---

        Cuerpo 1.
        """
      Y que el archivo "texto-2.md" tiene este contenido
        """
        ---
        title: Texto 2
        creator: Autora B
        date: 2026-01-01
        ---

        Cuerpo 2.
        """
      Y que el archivo "antologia.md" tiene este contenido
        """
        ---
        title: Antología
        type: collection
        date: 2026-03-01
        collectionCreator: Editora
        files:
          - texto-2.md
        ---

        Intro.
        """
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/texto-1-por-autora-a.html" dice "Antología"
      Y el archivo "dist/files/texto-1-por-autora-a.html" dice "Ver colección completa →"
      Y el archivo "dist/files/texto-1-por-autora-a.html" dice "Antologadora"
      Y el archivo "dist/files/texto-1-por-autora-a.html" dice "Editora"
      Y el archivo "dist/files/texto-1-por-autora-a.html" dice "Autora B"

    Escenario: Se muestran como máximo cinco tarjetas entre textos y colecciones
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y el proyecto produce html
      Y que el archivo "texto-1.md" tiene este contenido
        """
        ---
        title: Texto viejo
        date: 2026-01-01
        ---

        Cuerpo viejo.
        """
      Y que el archivo "texto-2.md" tiene este contenido
        """
        ---
        title: Texto 2
        date: 2026-02-01
        ---

        Cuerpo 2.
        """
      Y que el archivo "texto-3.md" tiene este contenido
        """
        ---
        title: Texto 3
        date: 2026-03-01
        ---

        Cuerpo 3.
        """
      Y que el archivo "coleccion-1.md" tiene este contenido
        """
        ---
        title: Colección 1
        type: collection
        date: 2026-04-01
        files:
          - texto-1.md
        ---
        """
      Y que el archivo "coleccion-2.md" tiene este contenido
        """
        ---
        title: Colección 2
        type: collection
        date: 2026-05-01
        files:
          - texto-2.md
        ---
        """
      Y que el archivo "coleccion-3.md" tiene este contenido
        """
        ---
        title: Colección 3
        type: collection
        date: 2026-06-01
        files:
          - texto-3.md
        ---
        """
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/texto-3.html" contiene 5 veces ">Reciente</h2>"
      Y el archivo "dist/files/texto-3.html" no dice "Texto viejo"

    Escenario: Una reciente con portada usa la marca de agua
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y el proyecto produce html
      Y existe la imagen "portada.png"
      Y que el archivo "texto-1.md" tiene este contenido
        """
        ---
        title: Texto con portada
        date: 2026-02-01
        frontCover: ./portada.png
        ---

        Cuerpo con portada.
        """
      Y que el archivo "texto-2.md" tiene este contenido
        """
        ---
        title: Texto sin portada
        date: 2026-01-01
        ---

        Cuerpo sin portada.
        """
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/texto-sin-portada.html" dice "tarjeta--con-fondo"
      Y el archivo "dist/files/texto-sin-portada.html" dice "tarjeta-fondo"
      Y el archivo "dist/files/texto-sin-portada.html" dice "-portada.webp"

  Regla de negocio: Las tarjetas van antes de las palabras clave del sitio

    Escenario: Reciente queda arriba de las palabras clave del sitio
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y el proyecto produce html
      Y que el archivo "iteraciones.config.yaml" tiene este contenido
        """
        language: es-MX
        format:
          html:
            generate: true
            site:
              title: Historikas
        """
      Y que el archivo "texto-1.md" tiene este contenido
        """
        ---
        title: Texto 1
        date: 2026-02-01
        keywords: [memoria, cuidados]
        ---

        Cuerpo 1.
        """
      Y que el archivo "texto-2.md" tiene este contenido
        """
        ---
        title: Texto 2
        date: 2026-03-01
        keywords: [memoria, cuidados]
        ---

        Cuerpo 2.
        """
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/texto-2.html" pone "Reciente" antes que "chip--conteo"
