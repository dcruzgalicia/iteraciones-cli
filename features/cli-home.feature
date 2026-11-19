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

    Escenario: Sin index.md la lista por defecto crea index.html y la tarjeta enlaza
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/test-document.html" contiene 'href="./index.html"'
      Y el archivo "dist/files/index.html" existe

    Escenario: La creadora del index va después de su publicación más reciente
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Dado que el archivo "autora.md" tiene este contenido
      """
      ---
      type: creator
      name: Ana
      slug: autora
      ---

      Bio.
      """
      Dado que el archivo "texto.md" tiene este contenido
      """
      ---
      title: Texto
      slug: texto
      creator: Ana
      date: 2030-01-01
      ---

      Contenido.
      """
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/index.html" pone 'href="./texto.html"' antes de 'href="./autora.html"'

    Escenario: La colección no adelanta la fecha de su creadora
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Dado que el archivo "autora.md" tiene este contenido
      """
      ---
      type: creator
      name: Ana
      slug: autora
      ---

      Bio.
      """
      Dado que el archivo "texto.md" tiene este contenido
      """
      ---
      title: Texto
      slug: texto
      creator: Ana
      date: 2020-01-01
      ---

      Contenido.
      """
      Dado que el archivo "antologia.md" tiene este contenido
      """
      ---
      title: Antología
      slug: antologia
      type: collection
      date: 2030-01-01
      files:
        - texto.md
      ---

      Intro.
      """
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/index.html" pone 'href="./antologia.html"' antes de 'href="./texto.html"'
      Y el archivo "dist/files/index.html" pone 'href="./texto.html"' antes de 'href="./autora.html"'

    Escenario: Dos creadoras con la misma fecha van después de su texto
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Dado que el archivo "autora-a.md" tiene este contenido
      """
      ---
      type: creator
      name: Ana A
      slug: autora-a
      ---

      Bio.
      """
      Dado que el archivo "autora-b.md" tiene este contenido
      """
      ---
      type: creator
      name: Ana B
      slug: autora-b
      ---

      Bio.
      """
      Dado que el archivo "texto-a.md" tiene este contenido
      """
      ---
      title: Texto A
      slug: texto-a
      creator: Ana A
      date: 2026-01-01
      ---

      Contenido.
      """
      Dado que el archivo "texto-b.md" tiene este contenido
      """
      ---
      title: Texto B
      slug: texto-b
      creator: Ana B
      date: 2026-01-01
      ---

      Contenido.
      """
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/index.html" pone 'href="./texto-a.html"' antes de 'href="./autora-a.html"'
      Y el archivo "dist/files/index.html" pone 'href="./texto-b.html"' antes de 'href="./autora-b.html"'

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

    Escenario: index.md puede ser una creadora
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Dado que el archivo "index.md" tiene este contenido
      """
      ---
      type: creator
      name: Ana Ejemplo
      ---

      Semblanza de Ana.
      """
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/index.html" dice "Ana Ejemplo"

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
