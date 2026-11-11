# language: es
Característica: init libro

  Como quien publica un libro con PDF y EPUB
  Quiero un proyecto con índice, portada y descargas
  Para compilar el libro sin configurar los formatos

  Regla de negocio: La plantilla libro activa TOC, oculta fechas y genera PDF/EPUB

    Escenario: init libro activa TOC y oculta fechas
      Dado que la raíz del proyecto está vacía
      Cuando parseo el comando "init libro" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "iteraciones.config.yaml" contiene "toc: true"
      Y el archivo "iteraciones.config.yaml" contiene "showDate: false"
      Y el archivo "iteraciones.config.yaml" contiene "frontCover"
      Y el archivo "iteraciones.config.yaml" contiene "Formatos"
      Y el archivo "iteraciones.config.yaml" contiene "Descargas"
      Y el archivo "menu.md" contiene "type: menu"
      Cuando construyo el proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/index.html" existe
      Y el archivo "dist/files/index.pdf" existe
      Y el archivo "dist/files/index.epub" existe
