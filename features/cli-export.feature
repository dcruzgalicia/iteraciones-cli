# language: es
Característica: El PDF y el EPUB llevan los metadatos del documento

  Como quien exporta a PDF o a EPUB para el Kindle
  Quiero que el idioma y los metadatos viajen al archivo
  Para no tener un EPUB en español que dice "UNTITLED" y un PDF en inglés

  Regla de negocio: El idioma de la configuración llega a babel

    Escenario: La configuración en inglés configura babel en inglés
      Dado que la raíz del proyecto tiene un proyecto en inglés
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/test-document.tex" contiene '\usepackage[english]{babel}'

    Escenario: El es-MX por defecto mantiene las opciones históricas de babel
      Dado que la raíz del proyecto tiene un proyecto en español de México
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/test-document.tex" contiene '\usepackage[spanish,mexico,es-noshorthands,es-noindentfirst]{babel}'

  Regla de negocio: Un párrafo corto al inicio no se protege

    Escenario: Un párrafo de contenido corto no recibe \mbox
      Dado que la raíz del proyecto tiene un proyecto con LaTeX
      Dado que el archivo "test.md" tiene este contenido
      """
      ---
      title: Test Document
      ---

      Contenido corto.
      """
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/test-document.tex" contiene '\noindent Contenido corto.'
      Y el archivo "dist/files/test-document.tex" no contiene '\mbox{Contenido}'

  Regla de negocio: El EPUB lleva los metadatos del frontmatter

    @requires-pandoc
    @requires-unzip
    Escenario: El EPUB declara título, autor, fecha e idioma
      Dado que la raíz del proyecto tiene un proyecto con EPUB
      Dado que el archivo "test.md" tiene este contenido
      """
      ---
      title: Test Document
      author: María Pérez
      date: 2026-01-01
      ---

      Contenido de prueba.
      """
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el EPUB declara la clave "dc:title" con el valor "Test Document"
      Y el EPUB declara la clave "dc:creator" con el valor "María Pérez"
      Y el EPUB declara la clave "dc:language" con el valor "es-MX"
      Y el EPUB declara la clave "dc:date" con el valor "2026-01-01"