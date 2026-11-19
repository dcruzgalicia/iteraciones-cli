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

  Regla de negocio: Cada colección del texto tiene su tarjeta

    Escenario: La tarjeta de la colección muestra autoras y antologadora
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y un texto de "Ana García"
      Y una colección de "Editora"
      Y otra colección con el mismo texto
      Y el proyecto produce html
      Cuando hago un build del proyecto
      Entonces la tarjeta de las colecciones lleva el chip "Colección"
      Y el chip "Colección" enlaza a "./coleccion.html"
      Y el archivo "dist/files/un-texto-por-ana-garcia.html" dice "Antología"
      Y el archivo "dist/files/un-texto-por-ana-garcia.html" dice "Ana García"
      Y el archivo "dist/files/un-texto-por-ana-garcia.html" dice "Antologadora"
      Y el archivo "dist/files/un-texto-por-ana-garcia.html" dice "Editora"
      Y el archivo "dist/files/un-texto-por-ana-garcia.html" dice "Ver colección completa →"
      Y el archivo "dist/files/un-texto-por-ana-garcia.html" dice "tarjeta--auto"
      Y el archivo "dist/files/un-texto-por-ana-garcia.html" no dice ">Colecciones</h2>"
      Y el archivo "dist/files/un-texto-por-ana-garcia.html" no dice ">Listas</h2>"

    Escenario: Un texto en dos colecciones lleva dos tarjetas
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y un texto de "Ana García"
      Y el texto es de una colección y de una lista
      Y otra colección con el mismo texto
      Y otra lista con el mismo texto
      Y el proyecto produce html
      Cuando hago un build del proyecto
      Entonces el archivo "dist/files/un-texto-por-ana-garcia.html" contiene 2 veces ">Colección</a>"
      Y el archivo "dist/files/un-texto-por-ana-garcia.html" dice "Antología"
      Y el archivo "dist/files/un-texto-por-ana-garcia.html" dice "Otra"

    Escenario: Un texto sólo en listas no lleva tarjeta de colección
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y un texto de "Ana García"
      Y el texto está en una lista
      Y otra lista con el mismo texto
      Y el proyecto produce html
      Cuando hago un build del proyecto
      Entonces el archivo "dist/files/un-texto-por-ana-garcia.html" no dice "href=\"./mi-lista.html\""
      Y el archivo "dist/files/un-texto-por-ana-garcia.html" no dice ">Colección</a>"
      Y el archivo "dist/files/un-texto-por-ana-garcia.html" no dice ">Listas</h2>"

  Regla de negocio: La biografía de la creadora lleva su chip

    Escenario: La tarjeta de la biografía lleva el chip de creadora
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y una creadora llamada "Ana García"
      Y otra creadora llamada "Otra Autora"
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

  Regla de negocio: La página de la creadora muestra sus textos en tarjetas

    Escenario: La creadora ve una tarjeta por cada texto donde aparece
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y una creadora llamada "Ana García"
      Y un texto de "Ana García"
      Y el proyecto produce html
      Cuando hago un build del proyecto
      Entonces el archivo "dist/files/ana-garcia.html" no dice ">Textos<"
      Y el archivo "dist/files/ana-garcia.html" dice "href=\"./un-texto-por-ana-garcia.html\""
      Y el archivo "dist/files/ana-garcia.html" dice "Leer texto completo →"

    Escenario: Sin página de creadora no hay tarjeta de textos
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y un texto de "Ana García"
      Y el proyecto produce html
      Cuando hago un build del proyecto
      Entonces la página de la creadora no lleva la tarjeta de textos
