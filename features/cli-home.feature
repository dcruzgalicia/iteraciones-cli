# language: es
Característica: El home y la bibliografía se resuelven antes de publicar

  Como quien tiene un proyecto con un artículo y una portada
  Quiero que el enlace al inicio exista sólo cuando existe la portada
  Y que cambiar la bibliografía regenere las exportaciones
  Para no publicar un 404 ni una cita vieja

  Regla de negocio: Un proyecto sin documentos sale bien y avisa

    Escenario: Un proyecto con un documento compila
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0

    Escenario: Un proyecto sin documentos avisa sin romper
      Dado que la raíz del proyecto tiene configuración pero ningún documento
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y la salida dice que hay 0 formatos activos
      Y la salida no dice "reutilizado"
      Y la salida dice "No se encontraron documentos Markdown en el proyecto."
      Y la salida no dice "✔ Todo listo."
      Y la salida no dice "ejecuta 'iteraciones validate'"

  Regla de negocio: La tarjeta identidad sólo enlaza si existe el home

    Escenario: Sin index.md la tarjeta identidad no es un enlace
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/test-document.html" no contiene '<a href="./index.html"'
      Y el archivo "dist/files/test-document.html" contiene "id=\"card-identity\""

    Escenario: Con index.md la tarjeta identidad enlaza al home
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Dado que el archivo "index.md" tiene este contenido
      """
      ---
      title: Inicio
      ---

      # Bienvenida

      Contenido.
      """
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/test-document.html" contiene 'href="./index.html"'
      Y el archivo "dist/files/index.html" existe

    Escenario: Desde un subdirectorio el enlace sube un nivel
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Dado que el archivo "index.md" tiene este contenido
      """
      ---
      title: Inicio
      ---

      # Bienvenida

      Contenido.
      """
      Dado que el archivo "posts/articulo.md" tiene este contenido
      """
      ---
      title: Artículo
      ---

      Contenido.
      """
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/posts/articulo.html" contiene 'href="./../index.html"'

  Regla de negocio: La bibliografía es parte del documento que la cita

    Escenario: Un cambio de bibliografía regenera las exportaciones
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Dado que la raíz del proyecto declara la bibliografía "refs/libro.bib"
      Dado que la bibliografía declara el título "Título original"
      Dado que el archivo "test.md" tiene este contenido
      """
      ---
      title: Test Document
      date: 2026-01-01
      ---

      Según @ejemplo2024, las citas funcionan.
      """
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/test-document.html" contiene "Título original"

    Escenario: Cambiar la bibliografía regenera la exportación
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Dado que la raíz del proyecto declara la bibliografía "refs/libro.bib"
      Dado que la bibliografía declara el título "Título original"
      Dado que el archivo "test.md" tiene este contenido
      """
      ---
      title: Test Document
      date: 2026-01-01
      ---

      Según @ejemplo2024, las citas funcionan.
      """
      Cuando hago un build del proyecto
      Dado que la bibliografía declara el título "Título nuevo"
      Cuando hago un build del proyecto
      Entonces el archivo "dist/files/test-document.html" contiene "Título nuevo"