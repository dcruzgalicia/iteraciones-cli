# language: es
Característica: los assets de la salida

  Como quien publica un sitio con su propia tipografía
  Quiero que la salida lleve el CSS y el logo, y nada que sobre
  Para que el build no crezca con archivos que nadie pidió

  Regla de negocio: El sitio usa las fuentes del navegador (#2487)

    Escenario: El CSS usa la sans y la mono del sistema
      Dado que la raíz del proyecto está vacía
      Y una salida para los assets
      Cuando construyo los assets
      Entonces en los assets hay:
        """
        assets/css/styles.css
        assets/images/favicon.svg
        """
      Y en los assets NO hay:
        """
        assets/fonts
        """
      Y el CSS sí dice:
        """
        -apple-system
        ui-monospace
        """
      Y el CSS no menciona:
        """
        Exo 2
        Space Mono
        """

    Escenario: El CSS propio del sitio sigue dentro
      Dado que la raíz del proyecto está vacía
      Y una salida para los assets
      Cuando construyo los assets
      Entonces el CSS no menciona:
        """
        @font-face
        url(../fonts/
        """
      Y el CSS sí dice:
        """
        @keyframes scroll-reveal
        """

  Regla de negocio: El logo raster vive en assets y el HTML lo referencia

    @requires-magick
    Escenario: Un logo a color se vuelve WebP y el HTML no lo incrusta
      Dado que la raíz del proyecto está vacía
      Y un proyecto con un logo a color y un documento
      Cuando compilo el sitio con su logo
      Entonces el build deja el archivo "assets/images/logo.webp"
      Y el build deja el archivo "assets/images/favicon.png"
      Y el HTML del documento referencia "src=\"./assets/images/logo.webp\""
      Y el HTML del documento no incrusta imágenes en base64

    @requires-magick
    Escenario: Un logo de un solo color se tiñe con el accent
      Dado que la raíz del proyecto está vacía
      Y un proyecto con un logo de un color y un documento
      Cuando compilo el sitio con su logo
      Entonces el logo webp está teñido con el accent

  Regla de negocio: El logo no se reescribe si no cambió

    Escenario: Una segunda llamada deja el logo intacto
      Dado que la raíz del proyecto está vacía
      Y una salida para los assets
      Cuando construyo los assets
      Entonces anoto la fecha del logo copiado
      Cuando construyo los assets otra vez
      Y el logo copiado no se ha vuelto a escribir

    Escenario: Un logo del proyecto modificado se vuelve a copiar
      Dado que la raíz del proyecto está vacía
      Y una salida para los assets
      Y un proyecto con un logo propio
      Cuando construyo los assets con el logo del proyecto
      Entonces el logo copiado dice "<svg>A</svg>"
      Y en los assets NO hay:
        """
        assets/mi-logo.svg
        """
      Y el proyecto cambia su logo a "<svg>B</svg>"
      Cuando construyo los assets con el logo del proyecto
      Y el logo copiado dice "<svg>B</svg>"

  Regla de negocio: Una salida vieja se reconoce

    Escenario: Una salida con css/ y fonts/ en la raíz es del layout anterior
      Dado que la raíz del proyecto está vacía
      Y una salida con el layout de assets anterior
      Entonces la salida se detecta como del layout anterior

    Escenario: Una salida con sólo assets/ es del layout nuevo
      Dado que la raíz del proyecto está vacía
      Y una salida con el layout nuevo
      Entonces la salida NO se detecta como del layout anterior