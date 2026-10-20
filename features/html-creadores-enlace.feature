# language: es
Característica: Los nombres de las autoras enlazan a su página

  Como quien lee una antología
  Quiero llegar de la portada de un texto a la página de quien lo escribió
  Para saber de quién es

  Regla de negocio: El enlace aparece si hay documento de creator

    Escenario: La banda de metadatos de un texto enlaza a su creadora
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y una creadora llamada "Ana García"
      Y un texto de "Ana García"
      Y el proyecto produce html
      Cuando hago un build del proyecto
      Entonces el archivo "dist/files/un-texto-por-ana-garcia.html" dice "href=\"./ana-garcia.html\""
      Y el archivo "dist/files/un-texto-por-ana-garcia.html" dice ">Ana García</a>"

    Escenario: La banda de una colección enlaza a su collectionCreator
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y una creadora llamada "Ana García"
      Y un texto de "Ana García"
      Y una colección de "Ana García"
      Y el proyecto produce html
      Cuando hago un build del proyecto
      Entonces el archivo "dist/files/antologia-por-ana-garcia.html" dice "href=\"./ana-garcia.html\""

    Escenario: La tarjeta de un miembro de la colección enlaza a su creadora
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y una creadora llamada "Ana García"
      Y un texto de "Ana García"
      Y una colección de "Ana García"
      Y el proyecto produce html
      Cuando hago un build del proyecto
      Entonces el archivo "dist/files/antologia-por-ana-garcia.html" dice ">Ana García</a>"

    Escenario: Sin documento de creator el nombre se queda como texto
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y un texto de "Ana García"
      Y el proyecto produce html
      Cuando hago un build del proyecto
      Entonces el archivo "dist/files/un-texto-por-ana-garcia.html" dice "Ana García"
      Y el archivo "dist/files/un-texto-por-ana-garcia.html" no dice ">Ana García</a>"

  Regla de negocio: El enlace se arma con el nombre de la creadora

    Escenario: Con documento de creator el nombre lleva enlace
      Cuando calculo los enlaces de las creadoras con:
      """
      {"Ana García": "./ana-garcia.html"}
      """
      Y los nombres enlazados son "Ana García"
      Entonces el nombre enlazado es "[Ana García](<./ana-garcia.html>)"

    Escenario: Sin documento de creator el nombre se queda igual
      Cuando calculo los enlaces de las creadoras con:
      """
      {}
      """
      Y los nombres enlazados son "Ana García"
      Entonces el nombre enlazado es "Ana García"

    Escenario: El collectionCreator acepta una lista de nombres
      Cuando calculo los enlaces de las creadoras con:
      """
      {"Ana García": "./ana-garcia.html"}
      """
      Y los nombres enlazados son "Ana García, Beto Ruiz"
      Entonces el nombre enlazado es "[Ana García](<./ana-garcia.html>), Beto Ruiz"

  Regla de negocio: Los nombres de la banda llevan línea de enlace

    Escenario: La banda de un texto underline sus nombres
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y una creadora llamada "Ana García"
      Y un texto de "Ana García"
      Y el proyecto produce html
      Cuando hago un build del proyecto
      Entonces el archivo "dist/files/un-texto-por-ana-garcia.html" dice "nombres-enlazados"

    Escenario: La banda de una colección underline a su collectionCreator
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y una creadora llamada "Ana García"
      Y un texto de "Ana García"
      Y una colección de "Ana García"
      Y el proyecto produce html
      Cuando hago un build del proyecto
      Entonces el archivo "dist/files/antologia-por-ana-garcia.html" dice "nombres-enlazados"
