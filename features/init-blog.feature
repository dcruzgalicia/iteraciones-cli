# language: es
Característica: init blog

  Como quien publica notas con fecha
  Quiero un proyecto con orden cronológico y sin índice
  Para empezar a escribir sin configurar el sitio

  Regla de negocio: La plantilla blog activa fechas y orden cronológico

    Escenario: init blog activa fechas y orden cronológico sin TOC
      Dado que la raíz del proyecto está vacía
      Cuando parseo el comando "init blog" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "iteraciones.config.yaml" contiene "style: expresivo"
      Y el archivo "iteraciones.config.yaml" contiene "toc: false"
      Y el archivo "iteraciones.config.yaml" contiene "showDate: true"
      Y el archivo "index.md" contiene "type: list"
      Y el archivo "index.md" contiene "order: date-desc"
      Y el archivo "index.md" contiene "filter:"
      Y el archivo "index.md" contiene "path: textos/"
      Y el directorio "paginas" existe
      Y el directorio "creadoras" existe
      Y el directorio "listas" existe
      Y el archivo "menu.md" contiene "type: menu"
      Y el directorio "textos" existe
      Y el archivo "textos/ejemplo.md" no existe
      Cuando construyo el proyecto
      Entonces el comando termina con el código de salida 0
      Y el proyecto recién creado pasa validate
      Y el archivo "dist/files/index.html" existe
