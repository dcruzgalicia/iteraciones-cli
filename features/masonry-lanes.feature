# language: es
Característica: el masonry con grid lanes nativo

  Como quien recorre el sitio
  Quiero las tarjetas en columnas que se acomodan de izquierda a derecha
  Para no depender de JavaScript ni de una librería

  Regla de negocio: El masonry es CSS puro, con grid lanes

    Escenario: El HTML usa grid y el CSS declara grid lanes
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y el proyecto produce html
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/index.html" dice "<main data-grid=\"lanes\""
      Y el archivo "dist/files/index.html" dice "grid-cols-1 md:grid-cols-2 2xl:grid-cols-3"
      Y el archivo "dist/files/index.html" no dice "columns-"
      Y el archivo "dist/files/assets/css/styles.css" contiene "display:grid-lanes"
      Y el archivo "dist/files/assets/css/styles.css" contiene "@supports not (display:grid-lanes)"

    Escenario: En un subdirectorio no hay rutas de JavaScript
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y el proyecto produce html
      Y una colección en "convocatorias" con 1 miembros
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/convocatorias/antologia.html" no dice "<script"
