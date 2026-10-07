# language: es
Característica: los assets de la salida

  Como quien publica un sitio con su propia tipografía
  Quiero que la salida lleve el CSS y el logo, y nada que sobre
  Para que el build no crezca con archivos que nadie pidió

  # Tramo 44 de la migración. 5 de los 11 casos de
  # `build-assets-cleanup.test.ts`.

  Regla de negocio: El sitio usa las fuentes del navegador (#2487)

    # Ni Exo 2 ni Space Mono. Copiar fuentes al `dist` son cientos de
    # kilobytes por build para una tipografía que el lector ya tiene en su
    # máquina.

    Escenario: El CSS usa la sans y la mono del sistema
      Dado que la raíz del proyecto está vacía
      Y una salida para los assets
      Cuando construyo los assets
      # `-apple-system` y `ui-monospace`: lo que ya tiene el lector.
      Entonces en los assets hay:
        """
        assets/css/styles.css
        assets/logo.svg
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

    # Quitar las fuentes no es vaciar el archivo: las animaciones son contenido,
    # no peso.
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

  Regla de negocio: El logo no se reescribe si no cambió

    # Si la segunda llamada reescribiera `logo.svg`, su mtime cambiaría, el hash
    # de los assets también, y el siguiente build invalidaría el CSS sin motivo.

    Escenario: Una segunda llamada deja el logo intacto
      Dado que la raíz del proyecto está vacía
      Y una salida para los assets
      Cuando construyo los assets
      Entonces anoto la fecha del logo copiado
      Cuando construyo los assets otra vez
      # El mtime idéntico es la aserción: si hubiera cambiado, el CSS se
      # invalidaría en cada build.
      Y el logo copiado no se ha vuelto a escribir

    # El destino del logo es fijo (`assets/logo.svg`), no la ruta que dice la
    # config: si se replicara la ruta también, el HTML apuntaría a un archivo
    # que no existe (#2450).
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

  # --- Tramo 44: reconocer el layout anterior (#2450) ---

  # Un `dist` hecho con la versión anterior tiene `css/` y `fonts/` SUELTOS en la
  # raíz. Esos archivos no los usa nadie y el CSS nuevo los ignora: sin
  # detectarlos, el sitio sale sin estilos sin ningún error.

  Regla de negocio: Una salida vieja se reconoce

    Escenario: Una salida con css/ y fonts/ en la raíz es del layout anterior
      Dado que la raíz del proyecto está vacía
      Y una salida con el layout de assets anterior
      # Sin esto el sitio sale sin estilos, y no hay ningún error que lo diga.
      Entonces la salida se detecta como del layout anterior

    Escenario: Una salida con sólo assets/ es del layout nuevo
      Dado que la raíz del proyecto está vacía
      Y una salida con el layout nuevo
      # No hay nada que reconstruir: los assets están donde el CSS los busca.
      Entonces la salida NO se detecta como del layout anterior