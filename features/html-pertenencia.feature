# language: es
Característica: los chips de pertenencia en las tarjetas de colecciones y listas

  Como quien recorre una antología o un listado
  Quiero ver en cada tarjeta a qué colecciones y listas pertenece el texto
  Para llegar a los otros lugares donde aparece sin abrir el texto

  Regla de negocio: Cada tarjeta lleva un chip por contenedor

    Escenario: Un texto en dos colecciones lleva el chip de la otra colección
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y un proyecto con un texto en dos colecciones
      Cuando hago un build del proyecto
      Entonces en el HTML de "antologia.html" el chip "Otra antología" enlaza a "./otra-antologia.html"
      Y en el HTML de "otra-antologia.html" el chip "Antología" enlaza a "./antologia.html"

    Escenario: El chip de la colección de la página no es un enlace
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y un proyecto con un texto en dos colecciones
      Cuando hago un build del proyecto
      Entonces en el HTML de "antologia.html" el chip "Antología" no es un enlace

    Escenario: La página del texto no lleva chips de pertenencia
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y un proyecto con un texto en dos colecciones
      Cuando hago un build del proyecto
      Entonces el HTML de "ensayo.html" no tiene chips de pertenencia

  Regla de negocio: Una lista propia también cuenta

    Escenario: En un listado, el texto lleva el chip de la lista a la que pertenece
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y un proyecto con un texto en una lista
      Cuando hago un build del proyecto
      Entonces en el HTML de "texto.html" el chip "Selección" enlaza a "./seleccion.html"
