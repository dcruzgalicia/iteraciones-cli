# language: es
Característica: las palabras clave del proyecto

  Como quien publica textos con temas
  Quiero que cada keyword tenga su lista y aparezca en las tarjetas
  Para llegar a los demás textos del mismo tema

  Regla de negocio: Cada keyword tiene su lista en keywords/

    Escenario: Dos textos con el mismo keyword comparten lista
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y un proyecto con textos que comparten keywords
      Cuando hago un build del proyecto
      Entonces el build deja el archivo "keywords/cuidados.html"
      Y el build deja el archivo "keywords/mujeres.html"
      Y el HTML de "keywords/cuidados.html" contiene "./../ensayo.html"
      Y el HTML de "keywords/cuidados.html" contiene "./../otro.html"

  Regla de negocio: Los chips de keyword

    Escenario: En la lista de textos cada keyword enlaza a su lista
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y un proyecto con textos que comparten keywords
      Cuando hago un build del proyecto
      Entonces en el HTML de "texto.html" el chip "cuidados" enlaza a "./keywords/cuidados.html"

    Escenario: El chip del keyword no va subrayado hasta el hover
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y un proyecto con textos que comparten keywords
      Cuando hago un build del proyecto
      Entonces el chip "cuidados" del HTML de "texto.html" sólo se subraya al pasar el ratón

    Escenario: En la página del keyword su propio chip no es un enlace
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y un proyecto con textos que comparten keywords
      Cuando hago un build del proyecto
      Entonces el chip "cuidados" del HTML de "keywords/cuidados.html" no es un enlace

  Regla de negocio: La página del texto y los metadatos

    Escenario: La página del texto lista sus keywords con su tarjeta
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y un proyecto con textos que comparten keywords
      Cuando hago un build del proyecto
      Entonces el HTML de "ensayo.html" contiene "Palabras clave"
      Y el HTML de "ensayo.html" contiene "./keywords/mujeres.html"
      Y el HTML de "ensayo.html" contiene "<meta name=\"keywords\" content=\"cuidados,mujeres\">"
      Y el HTML de "ensayo.html" no tiene chips de pertenencia

    @requires-pandoc
    Escenario: El EPUB lleva los keywords como dc:subject
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y un proyecto con textos y keywords en html y epub
      Cuando hago un build del proyecto
      Entonces el EPUB "ensayo" declara la clave "dc:subject" con el valor "cuidados"
