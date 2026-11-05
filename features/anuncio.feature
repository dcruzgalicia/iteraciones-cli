# language: es
Característica: los anuncios del sitio

  Como quien publica un aviso
  Quiero que su tarjeta salga en un slot del sitio
  Para destacarlo fuera del flujo normal de textos

  Regla de negocio: El anuncio elige su lugar

    Escenario: Con placement top aparece primero en el sidebar
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y el proyecto produce html
      Y que el archivo "anuncio.md" tiene este contenido
        """
        ---
        type: announcement
        title: Tercera convocatoria
        date: 2026-09-11
        creator: Histórikas
        placement: top
        ---

        Este es el anuncio.
        """
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/tercera-convocatoria-por-historikas.html" existe
      Y el archivo "dist/files/index.html" pone "</main>" antes que "Tercera convocatoria"
      Y el archivo "dist/files/anuncio.html" no existe

    Escenario: Con placement bottom aparece al final del sidebar
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y el proyecto produce html
      Y que el archivo "iteraciones.config.yaml" tiene este contenido
        """
        language: es-MX
        format:
          html:
            generate: true
            site:
              title: Test
              license: CC-BY-NC-ND-4.0
        """
      Y que el archivo "anuncio.md" tiene este contenido
        """
        ---
        type: announcement
        title: Anuncio del pie
        date: 2026-09-10
        creator: Histórikas
        placement: bottom
        ---

        Anuncio que va abajo.
        """
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/index.html" dice "Anuncio del pie"
      Y el archivo "dist/files/index.html" pone "</main>" antes que "Anuncio del pie"
      Y el archivo "dist/files/index.html" pone "Algunos derechos reservados." antes que "Anuncio del pie"

    Escenario: El anuncio no se duplica en las listas
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y el proyecto produce html
      Y que el archivo "anuncio.md" tiene este contenido
        """
        ---
        type: announcement
        title: Tercera convocatoria
        date: 2026-09-11
        creator: Histórikas
        placement: top
        ---

        Este es el anuncio.
        """
      Y otro texto de "Ana García"
      Cuando hago un build del proyecto
      Entonces el archivo "dist/files/index.html" contiene 1 veces "Tercera convocatoria"
      Y el archivo "dist/files/texto.html" contiene 1 veces "Tercera convocatoria"

    Escenario: Un placement inválido avisa y va arriba
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y el proyecto produce html
      Y que el archivo "anuncio.md" tiene este contenido
        """
        ---
        type: announcement
        title: Anuncio raro
        date: 2026-09-11
        creator: Histórikas
        placement: middle
        ---

        Anuncio con placement inválido.
        """
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y la salida dice "placement"
      Y el archivo "dist/files/index.html" dice "Anuncio raro"

    Escenario: La tarjeta trae la imagen de cabecera
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y el proyecto produce html
      Y que el archivo "foto.png" es un PNG de 1 por 1
      Y que el archivo "anuncio.md" tiene este contenido
        """
        ---
        type: announcement
        title: Tercera convocatoria
        date: 2026-09-11
        creator: Histórikas
        placement: top
        ---

        ![](./foto.png)

        Este es el anuncio.
        """
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/index.html" dice "anuncio-foto.webp"
      Y el archivo "dist/files/assets/images/anuncio-foto.webp" existe

    Escenario: Con dos anuncios el chip lleva a la lista de anuncios
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y el proyecto produce html
      Y que el archivo "anuncio.md" tiene este contenido
        """
        ---
        type: announcement
        title: Tercera convocatoria
        date: 2026-09-11
        creator: Histórikas
        placement: top
        ---

        Este es el anuncio.
        """
      Y que el archivo "otro-anuncio.md" tiene este contenido
        """
        ---
        type: announcement
        title: Anuncio del pie
        date: 2026-09-10
        creator: Histórikas
        placement: bottom
        ---

        Anuncio que va abajo.
        """
      Cuando hago un build del proyecto
      Entonces el archivo "dist/files/anuncio.html" existe
      Y el archivo "dist/files/anuncio.html" dice "Tercera convocatoria"
      Y el archivo "dist/files/anuncio.html" dice "Anuncio del pie"
      Y el archivo "dist/files/index.html" dice "href=\"./anuncio.html\""

    Escenario: Sin anuncios el sitio no cambia
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y el proyecto produce html
      Cuando hago un build del proyecto
      Entonces el archivo "dist/files/index.html" no dice "Anuncio"
