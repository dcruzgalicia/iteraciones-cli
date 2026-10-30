# language: es
Característica: el masonry horizontal del sitio

  Como quien recorre el sitio
  Quiero que las tarjetas se acomoden de izquierda a derecha
  Para leerlas en orden y sin depender de un CDN

  Regla de negocio: masonry-layout va empaquetado con el sitio

    Escenario: El sitio carga un solo JS y el contenedor del masonry
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y el proyecto produce html
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/assets/js/site.js" existe
      Y el archivo "dist/files/index.html" dice "<script src=\"./assets/js/site.js\" defer>"
      Y el archivo "dist/files/index.html" dice "<div data-grid=\"masonry\""
      Y el archivo "dist/files/index.html" dice "data-grid-sizer"
      Y el archivo "dist/files/index.html" dice "data-gutter-sizer"
      Y el archivo "dist/files/index.html" no dice "columns-"
      Y el archivo "dist/files/assets/css/styles.css" contiene "data-masonry-ready"

    Escenario: El JS trae la librería y no depende de un CDN
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y el proyecto produce html
      Cuando hago un build del proyecto
      Entonces el archivo "dist/files/assets/js/site.js" contiene "horizontalOrder"
      Y el archivo "dist/files/assets/js/site.js" no dice "cdn.jsdelivr"
      Y el archivo "dist/files/assets/js/site.js" no dice "unpkg"

    Escenario: En un subdirectorio el script se referencia con su ruta
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y el proyecto produce html
      Y una colección en "convocatorias" con 1 miembros
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/convocatorias/antologia.html" dice "<script src=\"./../assets/js/site.js\" defer>"
