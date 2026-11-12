# language: es
Característica: la tarjeta de entradas recientes del sidebar

  Como quien visita el sitio
  Quiero ver las cinco entradas más recientes al final del sidebar
  Para seguir leyendo sin volver al índice

  Regla de negocio: La tarjeta muestra las cinco entradas más nuevas

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
      Y el archivo "dist/files/texto-6.html" dice ">Recientes</h2>"
      Y el archivo "dist/files/texto-6.html" dice "list-disc"
      Y el archivo "dist/files/texto-6.html" dice "Texto 6"
      Y el archivo "dist/files/texto-6.html" dice "Texto 5"
      Y el archivo "dist/files/texto-6.html" dice "Texto 4"
      Y el archivo "dist/files/texto-6.html" dice "Texto 3"
      Y el archivo "dist/files/texto-6.html" dice "Texto 2"
      Y el archivo "dist/files/texto-6.html" no dice "Texto 1"

    Escenario: La lista por defecto de index no lleva la tarjeta de recientes
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y el proyecto produce html
      Cuando hago un build del proyecto
      Entonces el archivo "dist/files/index.html" no dice ">Recientes</h2>"

  Regla de negocio: La tarjeta va antes de las palabras clave del sitio

    Escenario: Recientes queda arriba de las palabras clave del sitio
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
      Y el archivo "dist/files/texto-2.html" pone "Recientes" antes que "items-center gap-1.5 rounded-md border-2 border-stone-500/60 bg-transparent"
