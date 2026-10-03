# language: es
Característica: El home y la bibliografía se resuelven antes de publicar

  Como quien tiene un proyecto con un artículo y una portada
  Quiero que el enlace al inicio exista sólo cuando existe la portada
  Y que cambiar la bibliografía regenere las exportaciones
  Para no publicar un 404 ni una cita vieja

  # 6 de los 31 casos que quedan de `cli-layer`.
  #
  # Los dos temas parecen distintos y tienen el mismo origen: el build resuelve
  # rutas y dependencias ANTES de generar, y si se equivoca el error sale como
  # un 404 en el navegador o como una cita del año pasado.

  Regla de negocio: Un proyecto sin documentos sale bien y avisa

    Escenario: Un proyecto con un documento compila
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0

    # Un proyecto recién inicializado no tiene documentos todavía. Eso no es un
    # error: el build sale con 0, dice "0 formatos" y avisa.

    Escenario: Un proyecto sin documentos avisa sin romper
      Dado que la raíz del proyecto tiene configuración pero ningún documento
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y la salida dice que hay 0 formatos activos
      Y la salida no dice "reutilizado"
      Y la salida dice "No se encontraron documentos Markdown en el proyecto."
      Y la salida no dice "✔ Todo listo."
      Y la salida no dice "ejecuta 'iteraciones validate'"

      # Tres detalles en un escenario, y los tres importan:
      #
      # - "0 formatos activos" y no "(reutilizado)": no hubo nada que reutilizar,
      #   y decirlo sería mentir sobre el estado de la caché.
      # - Sin "✔ Todo listo.": el cierre es neutral cuando hay advertencias.
      # - Sin la guía de `validate`: el aviso ya propone `iteraciones init`, y
      #   `validate` respondería "sin errores — 0 documentos", que no ayuda.

  Regla de negocio: La tarjeta identidad sólo enlaza si existe el home

    # Una tarjeta de identidad es el `<div>` que lleva el título del sitio. Sin
    # `index.md` no hay home, y un enlace a `./index.html` sería un 404 en la
    # primera página del sitio — justo la que más se mira.

    Escenario: Sin index.md la tarjeta identidad no es un enlace
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/test-document.html" no contiene '<a href="./index.html"'
      Y el archivo "dist/files/test-document.html" contiene "Tarjeta identidad"

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

    # Desde `posts/articulo.html` el home está un nivel arriba. La ruta
    # unificada es `./../index.html`: con `./index.html` el enlace buscaría un
    # home DENTRO de `posts/`, que no existe.

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

    # El `.bib` no es un archivo más del proyecto: su contenido va dentro del
    # HTML final. Si el build no lo mirara al invalidar, cambiar una cita
    # publicaría el texto viejo con la referencia nueva.

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