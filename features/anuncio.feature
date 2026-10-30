# language: es
Característica: los anuncios del sitio

  Como quien publica un aviso
  Quiero que su tarjeta salga en un slot del sitio
  Para destacarlo fuera del flujo normal de textos

  Regla de negocio: El anuncio elige su lugar

    Escenario: Con placement top sale después de Redes y antes del contenido
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
      Y el archivo "dist/files/index.html" pone "<div id=\"card-identity\"" antes que "Tercera convocatoria"
      Y el archivo "dist/files/index.html" pone "Tercera convocatoria" antes que "card-identity-footer"

    Escenario: Con placement bottom sale antes de la segunda Redes
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y el proyecto produce html
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
      Y el archivo "dist/files/index.html" pone "Anuncio del pie" antes que "card-identity-footer"

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

    Escenario: Sin anuncios el sitio no cambia
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y el proyecto produce html
      Cuando hago un build del proyecto
      Entonces el archivo "dist/files/index.html" no dice "Anuncio"
