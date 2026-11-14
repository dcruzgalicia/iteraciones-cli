Característica: estilos visuales del sitio

  Para elegir una identidad visual sin cambiar el modo claro/oscuro
  Quiero configurar site.style con tipografías del sistema

  Escenario: Sin style se conserva el estilo clásico
    Dado que la raíz del proyecto tiene un proyecto de prueba
    Y el proyecto produce html
    Cuando hago un build del proyecto
    Entonces el comando termina con el código de salida 0
    Y el archivo "dist/files/index.html" contiene "data-style=\"clasico\""
    Y el archivo "dist/files/assets/css/styles.css" contiene "font-family:system-ui"
    Y el archivo "dist/files/assets/css/styles.css" no contiene "@font-face"
    Y el archivo "dist/files/assets/css/styles.css" no contiene "fonts.googleapis.com"

  Esquema del escenario: El estilo <estilo> usa su tipografía del sistema
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
    Y el archivo "dist/files/assets/css/styles.css" contiene "<familia>"
    Y el archivo "dist/files/assets/css/styles.css" no contiene "@font-face"
    Y el archivo "dist/files/assets/css/styles.css" no contiene "fonts.googleapis.com"

    Ejemplos:
      | estilo        | familia   |
      | clasico       | system-ui |
      | expresivo     | Georgia   |
      | editorial     | Georgia   |
      | institucional | system-ui |

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
