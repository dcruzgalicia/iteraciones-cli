# language: es
Característica: Las tarjetas que van al final de la página de un texto

  Como quien lee un texto
  Quiero ver quién lo escribió y dónde está
  Para seguir leyendo

  Regla de negocio: La biografía de la creadora

    Escenario: El texto muestra la biografía de su creadora
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y una creadora llamada "Ana García"
      Y un texto de "Ana García"
      Y el proyecto produce html
      Cuando hago un build del proyecto
      Entonces el archivo "dist/files/un-texto-por-ana-garcia.html" dice "Bio de Ana García."
      Y el archivo "dist/files/un-texto-por-ana-garcia.html" dice "Ana García</a></h2>"

    Escenario: Sin documento de creadora no hay tarjeta
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y un texto de "Ana García"
      Y el proyecto produce html
      Cuando hago un build del proyecto
      Entonces el archivo "dist/files/un-texto-por-ana-garcia.html" no dice "Bio de"

    Escenario: La biografía va después del texto y antes del footer
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y una creadora llamada "Ana García"
      Y un texto de "Ana García"
      Y el proyecto produce html
      Cuando hago un build del proyecto
      Entonces el HTML del texto pone "Cuerpo del texto." antes que "Bio de Ana García."
      Y el HTML del texto pone "Bio de Ana García." antes que "card-identity-footer"

    Escenario: La biografía es una tarjeta propia, no va dentro de la del texto
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y una creadora llamada "Ana García"
      Y un texto de "Ana García"
      Y el proyecto produce html
      Cuando hago un build del proyecto
      Entonces la biografía del texto está fuera de su artículo
      Y la biografía del texto está en su propia tarjeta

  Regla de negocio: Las colecciones donde vive el texto

    Escenario: Con una sola colección la tarjeta se muestra
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y un texto de "Ana García"
      Y una colección de "Ana García"
      Y el proyecto produce html
      Cuando hago un build del proyecto
      Entonces el archivo "dist/files/un-texto-por-ana-garcia.html" dice "href=\"./antologia-por-ana-garcia.html\""

    Escenario: Con más de una colección el texto las lista
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y un texto de "Ana García"
      Y una colección de "Ana García"
      Y otra colección con el mismo texto
      Y el proyecto produce html
      Cuando hago un build del proyecto
      Entonces el archivo "dist/files/un-texto-por-ana-garcia.html" dice "href=\"./antologia-por-ana-garcia.html\""
      Y el archivo "dist/files/un-texto-por-ana-garcia.html" dice "href=\"./otra.html\""

    Escenario: Un texto que no está en ninguna colección no lleva esa tarjeta
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y un texto de "Ana García"
      Y el proyecto produce html
      Cuando hago un build del proyecto
      Entonces el archivo "dist/files/un-texto-por-ana-garcia.html" no dice "href=\"./antologia-por-ana-garcia.html\""

  Regla de negocio: La tarjeta de las colecciones lleva chips, no un título

    Escenario: El texto no lleva el título de la tarjeta
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y un texto de "Ana García"
      Y el texto es de una colección y de una lista
      Y el proyecto produce html
      Cuando hago un build del proyecto
      Entonces el archivo "dist/files/un-texto-por-ana-garcia.html" no dice "También está en"

    Escenario: Un texto en una colección y en una lista lleva los dos chips
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y un texto de "Ana García"
      Y el texto es de una colección y de una lista
      Y el proyecto produce html
      Cuando hago un build del proyecto
      Entonces la tarjeta de las colecciones lleva el chip "Colecciones"
      Y la tarjeta de las colecciones lleva el chip "Listas"
      Y el chip "Colecciones" enlaza a "./coleccion.html"
      Y el chip "Listas" enlaza a "./lista.html"

    Escenario: Un texto sólo en listas no lleva la tarjeta de colecciones
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y un texto de "Ana García"
      Y el texto está en una lista
      Y otra lista con el mismo texto
      Y el proyecto produce html
      Cuando hago un build del proyecto
      Entonces el archivo "dist/files/un-texto-por-ana-garcia.html" no dice "href=\"./mi-lista.html\""
      Y la tarjeta de las colecciones no lleva el chip "Colecciones"

  Regla de negocio: La biografía de la creadora lleva su chip

    Escenario: La tarjeta de la biografía lleva el chip de creadora
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y una creadora llamada "Ana García"
      Y un texto de "Ana García"
      Y el proyecto produce html
      Cuando hago un build del proyecto
      Entonces la tarjeta de las colecciones lleva el chip "Colaboradora"
      Y el chip "Colaboradora" enlaza a "./creadora.html"

  Regla de negocio: El nombre de la creadora lleva a su página

    Escenario: El nombre de la creadora en la biografía es un enlace
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y una creadora llamada "Ana García"
      Y un texto de "Ana García"
      Y el proyecto produce html
      Cuando hago un build del proyecto
      Entonces el nombre de la creadora en la biografía es un enlace

  Regla de negocio: La página de la creadora lista sus textos

    Escenario: La creadora ve los textos en los que aparece
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y una creadora llamada "Ana García"
      Y un texto de "Ana García"
      Y el proyecto produce html
      Cuando hago un build del proyecto
      Entonces la página de la creadora lleva la tarjeta de textos
      Y el archivo "dist/files/ana-garcia.html" dice "href=\"./un-texto-por-ana-garcia.html\""

    Escenario: Un texto no lleva la tarjeta de textos
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y un texto de "Ana García"
      Y el proyecto produce html
      Cuando hago un build del proyecto
      Entonces la página de la creadora no lleva la tarjeta de textos
