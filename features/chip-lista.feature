# language: es
Característica: El chip de tipo lleva a la lista de ese type

  Como quien recorre una antología
  Quiero que el chip "Texto" me lleve a todos los textos
  Para no buscar uno por uno

  Regla de negocio: Las listas por defecto

    Escenario: El build escribe una lista por type
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y una creadora llamada "Ana García"
      Y un texto de "Ana García"
      Y el proyecto produce html
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/texto.html" existe
      Y el archivo "dist/files/creadora.html" existe
      Y el archivo "dist/files/coleccion.html" no existe
      Y el archivo "dist/files/lista.html" no existe

    Escenario: Cada lista trae los documentos de su type
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y una creadora llamada "Ana García"
      Y un texto de "Ana García"
      Y el proyecto produce html
      Cuando hago un build del proyecto
      Entonces el archivo "dist/files/texto.html" dice "Un texto"
      Y el archivo "dist/files/creadora.html" dice "Ana García"
      Y el archivo "dist/files/coleccion.html" no existe

    Escenario: La lista de un type que no existe queda vacía
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y el proyecto produce html
      Cuando hago un build del proyecto
      Entonces el archivo "dist/files/lista.html" no existe

    Escenario: La lista de creadoras no pone "Anónima" en las tarjetas
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y una creadora llamada "Ana García"
      Y el proyecto produce html
      Cuando hago un build del proyecto
      Entonces el archivo "dist/files/creadora.html" dice "Ana García"
      Y el archivo "dist/files/creadora.html" no dice "Anónima"

  Regla de negocio: El chip es un enlace

    Escenario: El chip de un texto lleva a la lista de textos
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y un texto de "Ana García"
      Y el proyecto produce html
      Cuando hago un build del proyecto
      Entonces el archivo "dist/files/un-texto-por-ana-garcia.html" dice "href=\"./texto.html\""
      Y el archivo "dist/files/un-texto-por-ana-garcia.html" dice ">Texto</a>"

    Escenario: El chip de una colección lleva a la lista de colecciones
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y un texto de "Ana García"
      Y una colección de "Ana García"
      Y el proyecto produce html
      Cuando hago un build del proyecto
      Entonces el archivo "dist/files/antologia-por-ana-garcia.html" dice "href=\"./coleccion.html\""

    Escenario: El chip de la tarjeta de un miembro lleva a la lista de su type
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y un texto de "Ana García"
      Y una colección de "Ana García"
      Y el proyecto produce html
      Cuando hago un build del proyecto
      Entonces el archivo "dist/files/antologia-por-ana-garcia.html" dice "href=\"./texto.html\""
