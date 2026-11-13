# language: es
Característica: init colectiva

  Como quien coordina una colectiva
  Quiero la portada, el menú y las carpetas de sus types
  Para recibir textos, creadoras, colecciones y convocatorias

  Regla de negocio: La plantilla colectiva deja los types y la portada listos

    Escenario: init colectiva deja portada, menú y los types de la colectiva
      Dado que la raíz del proyecto está vacía
      Cuando parseo el comando "init colectiva" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 0
      Y el directorio "textos" existe
      Y el directorio "creadoras" existe
      Y el directorio "colecciones" existe
      Y el directorio "convocatorias" existe
      Y el directorio "paginas" existe
      Y el directorio "listas" existe
      Y el archivo "index.md" existe
      Y el archivo "iteraciones.config.yaml" contiene "style: expresivo"
      Y el archivo "convocatorias.md" contiene "type: list"
      Y el archivo "menu.md" contiene "Convocatorias"
      Cuando construyo el proyecto
      Entonces el comando termina con el código de salida 0
      Y el proyecto recién creado pasa validate
      Y el archivo "dist/files/index.html" existe
      Y el archivo "dist/files/convocatorias.html" existe
