# language: es
Característica: estilos visuales del sitio

  Para elegir una identidad visual sin cambiar el modo claro/oscuro
  Quiero configurar site.style y que las fuentes se sirvan localmente

  Escenario: Sin style se conserva el estilo clásico
    Dado que la raíz del proyecto tiene un proyecto de prueba
    Y el proyecto produce html
    Cuando hago un build del proyecto
    Entonces el comando termina con el código de salida 0
    Y el archivo "dist/files/index.html" contiene "data-style=\"clasico\""
    Y el archivo "dist/files/assets/css/styles.css" no contiene "fonts.googleapis.com"
    Y el archivo "dist/files/assets/css/styles.css" no contiene "caveat-latin.woff2"

  Esquema del escenario: El estilo <estilo> usa su fuente local
    Dado que la raíz del proyecto tiene un proyecto de prueba
    Y el proyecto produce html
    Y que el archivo "iteraciones.config.yaml" tiene este contenido
      """
      language: es-MX
      format:
        html:
          generate: true
          site:
            title: Estilo
            style: <estilo>
            theme: light
      """
    Y que el archivo "index.md" tiene este contenido
      """
      ---
      title: Inicio
      ---

      Contenido.
      """
    Cuando hago un build del proyecto
    Entonces el comando termina con el código de salida 0
    Y el archivo "dist/files/index.html" contiene "data-style=\"<estilo>\""
    Y el archivo "dist/files/assets/css/styles.css" contiene "@font-face"
    Y el archivo "dist/files/assets/css/styles.css" contiene "<fuente>"
    Y el archivo "dist/files/assets/fonts/<fuente>" existe
    Y el archivo "dist/files/assets/fonts/<licencia>" existe
    Y el archivo "dist/files/assets/css/styles.css" no contiene "fonts.googleapis.com"

    Ejemplos:
      | estilo        | fuente                        | licencia                     |
      | expresivo     | caveat-latin.woff2            | caveat-OFL.txt               |
      | editorial     | source-serif-4-latin.woff2    | source-serif-4-OFL.txt       |
      | institucional | public-sans-latin.woff2       | public-sans-OFL.txt          |

  Escenario: Un estilo expresivo conserva el modo oscuro
    Dado que la raíz del proyecto tiene un proyecto de prueba
    Y el proyecto produce html
    Y que el archivo "iteraciones.config.yaml" tiene este contenido
      """
      language: es-MX
      format:
        html:
          generate: true
          site:
            title: Estilo
            style: expresivo
            theme: dark
      """
    Y que el archivo "index.md" tiene este contenido
      """
      ---
      title: Inicio
      ---

      Contenido.
      """
    Cuando hago un build del proyecto
    Entonces el comando termina con el código de salida 0
    Y el archivo "dist/files/index.html" contiene "data-theme=\"dark\""
    Y el archivo "dist/files/index.html" contiene "data-style=\"expresivo\""
    Y el archivo "dist/files/assets/css/styles.css" contiene "[data-style=expresivo][data-theme=dark]"
