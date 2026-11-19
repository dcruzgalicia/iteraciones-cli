Característica: estilos visuales del sitio

  Para elegir una identidad visual con dos tipografías por estilo
  Quiero configurar site.style con fuentes locales para títulos y textos

  Escenario: Sin style se usa el estilo radar
    Dado que la raíz del proyecto tiene un proyecto de prueba
    Y el proyecto produce html
    Cuando hago un build del proyecto
    Entonces el comando termina con el código de salida 0
    Y el archivo "dist/files/index.html" contiene "data-style=\"radar\""
    Y el archivo "dist/files/assets/css/styles.css" contiene "Chakra Petch"
    Y el archivo "dist/files/assets/css/styles.css" contiene "Space Grotesk"
    Y el archivo "dist/files/assets/css/styles.css" contiene "font-display:fallback"
    Y el archivo "dist/files/assets/fonts/chakra-petch-600-latin.woff2" existe
    Y el archivo "dist/files/assets/fonts/space-grotesk-latin.woff2" existe
    Y el archivo "dist/files/assets/css/styles.css" no contiene "fonts.googleapis.com"

  Esquema del escenario: El estilo <estilo> usa sus dos fuentes locales
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
    Y el archivo "dist/files/assets/css/styles.css" contiene "<titulo>"
    Y el archivo "dist/files/assets/css/styles.css" contiene "<texto>"
    Y el archivo "dist/files/assets/css/styles.css" contiene "url(../fonts/<archivo-titulo>)"
    Y el archivo "dist/files/assets/css/styles.css" contiene "url(../fonts/<archivo-texto>)"
    Y el archivo "dist/files/assets/css/styles.css" contiene "font-display:fallback"
    Y el archivo "dist/files/assets/fonts/<archivo-titulo>" existe
    Y el archivo "dist/files/assets/fonts/<archivo-texto>" existe
    Y el archivo "dist/files/assets/fonts/<licencia-titulo>" existe
    Y el archivo "dist/files/assets/fonts/<licencia-texto>" existe
    Y el archivo "dist/files/assets/css/styles.css" no contiene "fonts.googleapis.com"

    Ejemplos:
      | estilo        | titulo          | texto            | archivo-titulo                        | archivo-texto                         | licencia-titulo              | licencia-texto                   |
      | radar        | Chakra Petch    | Space Grotesk    | chakra-petch-600-latin.woff2          | space-grotesk-latin.woff2             | chakra-petch-OFL.txt         | space-grotesk-OFL.txt            |
      | notebook     | Caveat          | Nunito           | caveat-latin.woff2                    | nunito-latin.woff2                    | caveat-OFL.txt               | nunito-OFL.txt                   |
      | press        | Playfair Display | Libre Baskerville | playfair-display-latin.woff2        | libre-baskerville-regular-latin.woff2 | playfair-display-OFL.txt     | libre-baskerville-OFL.txt        |
      | modern       | Public Sans     | Source Sans 3    | public-sans-latin.woff2               | source-sans-3-latin.woff2             | public-sans-OFL.txt          | source-sans-3-OFL.txt            |

  Escenario: Un estilo viejo se normaliza al nombre nuevo
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
            style: clasico
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
    Y el archivo "dist/files/index.html" contiene "data-style=\"radar\""
    Y el archivo "dist/files/assets/css/styles.css" contiene "data-style=radar"

  Escenario: Un estilo notebook conserva el modo oscuro
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
            style: notebook
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
    Y el archivo "dist/files/index.html" contiene "data-style=\"notebook\""
    Y el archivo "dist/files/assets/css/styles.css" contiene "color-scheme:dark"
    Y el archivo "dist/files/assets/css/styles.css" contiene "data-style=notebook"
