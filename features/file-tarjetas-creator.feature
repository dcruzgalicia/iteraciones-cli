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
      Y el archivo "dist/files/un-texto-por-ana-garcia.html" dice "Ana García</h2>"

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

  Regla de negocio: Las colecciones donde vive el texto

    Escenario: El texto lista las colecciones donde está
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y un texto de "Ana García"
      Y una colección de "Ana García"
      Y el proyecto produce html
      Cuando hago un build del proyecto
      Entonces el archivo "dist/files/un-texto-por-ana-garcia.html" dice "Colecciones y listas"
      Y el archivo "dist/files/un-texto-por-ana-garcia.html" dice "href=\"./antologia-por-ana-garcia.html\""

    Escenario: Un texto que no está en ninguna colección no lleva esa tarjeta
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y un texto de "Ana García"
      Y el proyecto produce html
      Cuando hago un build del proyecto
      Entonces el archivo "dist/files/un-texto-por-ana-garcia.html" no dice "Colecciones y listas"
