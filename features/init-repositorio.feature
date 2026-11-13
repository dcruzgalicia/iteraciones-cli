# language: es
Característica: init repositorio

  Como quien publica un repositorio de documentos
  Quiero metadatos, licencias y una página de catálogo
  Para ordenar los documentos mientras llega la búsqueda

  Regla de negocio: La plantilla repositorio deja metadatos, catálogo y licencia

    Escenario: init repositorio deja metadatos, catálogo y licencia
      Dado que la raíz del proyecto está vacía
      Cuando parseo el comando "init repositorio" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "iteraciones.config.yaml" contiene "publisher:"
      Y el archivo "iteraciones.config.yaml" contiene "license: CC-BY-NC-ND-4.0"
      Y el archivo "iteraciones.config.yaml" contiene "style: institucional"
      Y el archivo "iteraciones.config.yaml" contiene "ponytail:"
      Y el archivo "index.md" contiene "type: list"
      Y el archivo "index.md" contiene "path: documentos/"
      Y el archivo "catalogo.md" no existe
      Y el archivo "menu.md" no contiene "Catálogo"
      Y el directorio "paginas" existe
      Y el directorio "listas" existe
      Cuando construyo el proyecto
      Entonces el comando termina con el código de salida 0
      Y el proyecto recién creado pasa validate
      Y el archivo "dist/files/index.html" existe
      Y el archivo "dist/files/buscar-en-el-catalogo.html" no existe
