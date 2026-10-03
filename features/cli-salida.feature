# language: es
Característica: El nombre de la salida y la portada se validan antes de compilar

  Como quien publica y no quiere descubrir un slug roto cuando ya compartí el link
  Quiero que el build me diga qué nombre o qué imagen no sirven
  Para arreglarlo antes de que exista una URL que depois no existe

  # 9 de los 39 casos que quedan de `cli-layer`: 3 de `slug`, 4 de `titleImage` y
  # 2 de documento sin cuerpo.
  #
  # Los tres son el mismo negocio: el build separa el nombre del archivo y la
  # imagen que va a la portada, y **falla antes de compilar** si alguno no sirve.
  # La alternativa —compilar y dejar que latexmk se queje— produce un error de
  # LaTeX que no dice qué archivo del proyecto está mal.

  Regla de negocio: El slug tiene que ser un nombre válido y único

    Escenario: Un slug con espacios y mayúsculas aborta el build
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Dado que el archivo "test.md" tiene este contenido
      """
      ---
      title: Test Document
      slug: Mi URL Inválida
      ---

      Contenido.
      """
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 1
      Y el error dice "slug inválido"

    # Dos documentos con el mismo slug NO es "el segundo pisa al primero": es un
    # documento que desaparece. El build aborta.

    Escenario: Dos documentos con el mismo slug abortan el build
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Dado que el archivo "uno.md" tiene este contenido
      """
      ---
      title: Uno
      slug: mismo
      ---

      Contenido.
      """
      Dado que el archivo "dos.md" tiene este contenido
      """
      ---
      title: Dos
      slug: mismo
      ---

      Contenido.
      """
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 1
      Y el error dice "slugs duplicados"

    # `validate` dice "slug duplicado" (singular) y el build "slugs duplicados":
    # el feature lo deja escrito. Son dos mensajes de dos capas distintas, no uno
    # mal escrito.

    Escenario: validate también reporta los slugs duplicados
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Dado que el archivo "uno.md" tiene este contenido
      """
      ---
      title: Uno
      slug: mismo
      ---

      Contenido.
      """
      Dado que el archivo "dos.md" tiene este contenido
      """
      ---
      title: Dos
      slug: mismo
      ---

      Contenido.
      """
      Cuando corro "validate"
      Entonces el comando termina con el código de salida 1
      Y el error dice "slug duplicado"

  Regla de negocio: La portada tiene que existir y su ruta tiene que ser LaTeX-safe

    # El nombre de archivo puede llevar guion bajo — `mi_portada.png` — y LaTeX
    # lo lee como un subíndice. Sin escapar, el `\titleimage{..._...}` falla al
    # compilar con un error que no menciona el archivo del proyecto.

    Escenario: Una portada con guion bajo se escapa en el .tex
      Dado que la raíz del proyecto tiene un proyecto con LaTeX
      Dado que el archivo "mi_portada.png" es un PNG de 1 por 1
      Dado que el archivo "test.md" tiene este contenido
      """
      ---
      title: Test Document
      titleImage: ./mi_portada.png
      ---

      Contenido.
      """
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/test-document.tex" apunta a la imagen "mi_portada.png"
      Y el archivo "dist/files/test-document.tex" no contiene "\_"

      # "apunta a la imagen" acepta las dos formas: la ruta absoluta original, o
      # la copia procesada (CMYK) que deja ImageMagick. Cuál de las dos depende
      # de si el build corrió ImageMagick, y eso no es parte de la regla.

    Escenario: Una portada inexistente falla con el nombre del archivo
      Dado que la raíz del proyecto tiene un proyecto con LaTeX
      Dado que el archivo "test.md" tiene este contenido
      """
      ---
      title: Test Document
      titleImage: ./no_existe.png
      ---

      Contenido.
      """
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 1
      Y el error dice "titleImage no encontrado"
      Y el error menciona la ruta real de "no_existe.png"

    Escenario: La portada de la configuración se aplica a todos los documentos
      Dado que la raíz del proyecto tiene un proyecto con LaTeX
      Dado que el archivo "portada.png" es un PNG de 1 por 1
      Dado que la raíz del proyecto declara la portada "portada.png"
      Dado que el archivo "test.md" tiene este contenido
      """
      ---
      title: Test Document
      ---

      Contenido.
      """
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/test-document.tex" contiene "\titleimage{"

    Escenario: La portada del frontmatter gana sobre la de la configuración
      Dado que la raíz del proyecto tiene un proyecto con LaTeX
      Dado que el archivo "portada.png" es un PNG de 1 por 1
      Dado que el archivo "portada-fm.png" es un PNG de 1 por 1
      Dado que la raíz del proyecto declara la portada "portada.png"
      Dado que el archivo "test.md" tiene este contenido
      """
      ---
      title: Test Document
      titleImage: ./portada-fm.png
      ---

      Contenido.
      """
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/test-document.tex" contiene "\titleimage{"
      Y el archivo "dist/files/test-document.tex" contiene "portada-fm"

  Regla de negocio: Un documento sin cuerpo es un error

    # #2463: el build soltaba estos documentos en silencio. El resultado era un
    # sitio con un artículo menos y ningún error — la peor forma de perder un
    # documento. Y el frontmatter vacío es un caso distinto del archivo vacío:
    # dos mensajes distintos porque son dos errores distintos.

    Escenario: Un frontmatter sin cuerpo no se omite en silencio
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Dado que el archivo "vacio.md" tiene este contenido
      """
      ---
      title: Vacío
      ---
      """
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 1
      Y el error dice "vacio.md"
      Y el error dice "no tiene contenido después del frontmatter; agrega un body para proceder con el build"

    Escenario: Un archivo enteramente vacío no se omite en silencio
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Dado que el archivo "hueco.md" está vacío
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 1
      Y el error dice "hueco.md"
      Y el error dice "está vacío; agrega un body para proceder con el build"