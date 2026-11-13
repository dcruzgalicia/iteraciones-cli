# language: es
Característica: los assets de la salida

  Como quien publica un sitio con su propia tipografía
  Quiero que la salida lleve el CSS y el logo, y nada que sobre
  Para que el build no crezca con archivos que nadie pidió

  Regla de negocio: El estilo clásico usa fuentes locales con aire técnico

    Escenario: El CSS del estilo clásico usa Space Grotesk y Chakra Petch
      Dado que la raíz del proyecto está vacía
      Y una salida para los assets
      Cuando construyo los assets
      Entonces en los assets hay:
        """
        assets/css/styles.css
        assets/images/favicon.png
        assets/fonts/space-grotesk-latin.woff2
        assets/fonts/chakra-petch-600-latin.woff2
        """
      Y el CSS sí dice:
        """
        Space Grotesk
        Chakra Petch
        """
      Y el CSS no menciona:
        """
        Exo 2
        Space Mono
        """

    Escenario: Un estilo con fuente propia copia solo sus fuentes
      Dado que la raíz del proyecto está vacía
      Y una salida para los assets con estilo "expresivo"
      Cuando construyo los assets con ese estilo
      Entonces en los assets hay:
        """
        assets/fonts/caveat-latin.woff2
        assets/fonts/kalam-400-latin.woff2
        assets/fonts/caveat-OFL.txt
        """
      Y en los assets NO hay:
        """
        assets/fonts/public-sans-latin.woff2
        """
      Y el CSS sí dice:
        """
        @font-face
        data:font/woff2;base64
        Caveat
        """

    Escenario: El CSS propio del sitio sigue dentro
      Dado que la raíz del proyecto está vacía
      Y una salida para los assets
      Cuando construyo los assets
      Entonces el CSS sí dice:
        """
        @keyframes scroll-reveal
        --color-accent-500
        """

  Regla de negocio: El logo raster vive en assets y el HTML lo referencia

    Escenario: Un logo a color se vuelve WebP y el HTML no lo incrusta
      Dado que la raíz del proyecto está vacía
      Y un proyecto con un logo a color y un documento
      Cuando compilo el sitio con su logo
      Entonces el build deja el archivo "assets/images/logo.webp"
      Y el build deja el archivo "assets/images/favicon.png"
      Y el HTML del documento referencia "src=\"./assets/images/logo.webp\""
      Y el HTML del documento no incrusta imágenes en base64

    Escenario: El logo por defecto usa el accent y conserva transparencia
      Dado que la raíz del proyecto está vacía
      Y el proyecto produce html
      Y que el archivo "doc.md" tiene este contenido
        """
        ---
        title: Doc
        ---

        Hola.
        """
      Cuando hago un build del proyecto
      Entonces el build deja el archivo "assets/images/logo.webp"
      Y el build deja el archivo "assets/images/favicon.png"
      Y el HTML del documento referencia "src=\"./assets/images/logo.webp\""
      Y el logo webp está teñido con el accent
      Y el logo webp conserva transparencia

    Escenario: Un logo de un solo color se tiñe con el accent
      Dado que la raíz del proyecto está vacía
      Y un proyecto con un logo de un color y un documento
      Cuando compilo el sitio con su logo
      Entonces el logo webp está teñido con el accent
      Y el logo webp conserva transparencia

  Regla de negocio: El logo no se reescribe si no cambió

    Escenario: Una segunda llamada mantiene el logo en WebP
      Dado que la raíz del proyecto está vacía
      Y una salida para los assets
      Cuando construyo los assets
      Y construyo los assets otra vez
      Entonces en los assets hay:
        """
        assets/images/logo.webp
        assets/images/favicon.png
        """

    Escenario: Un logo propio SVG se convierte a WebP
      Dado que la raíz del proyecto está vacía
      Y una salida para los assets
      Y un proyecto con un logo propio
      Cuando construyo los assets con el logo del proyecto
      Entonces en los assets hay:
        """
        assets/images/logo.webp
        assets/images/favicon.png
        """
      Y en los assets NO hay:
        """
        assets/mi-logo.svg
        assets/images/logo.svg
        assets/images/favicon.svg
        """

  Regla de negocio: Una salida vieja se reconoce

    Escenario: Una salida con css/ y fonts/ en la raíz es del layout anterior
      Dado que la raíz del proyecto está vacía
      Y una salida con el layout de assets anterior
      Entonces la salida se detecta como del layout anterior

    Escenario: Una salida con sólo assets/ es del layout nuevo
      Dado que la raíz del proyecto está vacía
      Y una salida con el layout nuevo
      Entonces la salida NO se detecta como del layout anterior