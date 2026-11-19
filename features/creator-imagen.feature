Característica: el retrato de la creadora en sus tarjetas

  Como quien recorre las creadoras del sitio
  Quiero ver su retrato en la tarjeta
  Para reconocerla sin abrir su página

  Regla de negocio: La lista de creadoras muestra el retrato

    Escenario: El retrato va después del chip y antes del nombre
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y el proyecto produce html
      Y una creadora llamada "Ana García" con retrato "ana.jpg"
      Y otra creadora llamada "Otra Autora"
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/creadora.html" dice "-ana.webp"
      Y el archivo "dist/files/creadora.html" dice "width:100px;height:100px"
      Y el archivo "dist/files/creadora.html" dice "retrato__img"
      Y el archivo "dist/files/creadora.html" dice "aria-label=\"Ver la biografía de Ana García\" class=\"retrato__enlace"
      Y el archivo "dist/files/creadora.html" pone "Retrato de Ana García" antes que ">Ana García</a>"
      Y el archivo "dist/files/creadora.html" dice "tarjeta-titulo--centrado"

    Escenario: La tarjeta de autora de un texto también lleva el retrato
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y el proyecto produce html
      Y una creadora llamada "Ana García" con retrato "ana.jpg"
      Y un texto de "Ana García"
      Cuando hago un build del proyecto
      Entonces el archivo "dist/files/un-texto-por-ana-garcia.html" dice "Retrato de Ana García"
      Y el archivo "dist/files/un-texto-por-ana-garcia.html" pone "Retrato de Ana García" antes que "class=\"not-prose tarjeta-titulo tarjeta-titulo--centrado tarjeta-titulo--creadora\""

    Escenario: La página de la creadora integra el retrato en la tarjeta de encabezado
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y el proyecto produce html
      Y una creadora llamada "Ana García" con retrato "ana.jpg"
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/ana-garcia.html" dice "Retrato de Ana García"
      Y el archivo "dist/files/ana-garcia.html" dice "-ana.webp"
      Y el archivo "dist/files/ana-garcia.html" dice "portada portada--front"
      Y el archivo "dist/files/ana-garcia.html" no dice "Semblanza"
      Y el archivo "dist/files/ana-garcia.html" no dice "contenido-retrato"
      Y el archivo "dist/files/ana-garcia.html" no dice "card-document"
      Y el archivo "dist/files/ana-garcia.html" pone "<div id=\"card-identity\"" antes que "-ana.webp"
      Y el archivo "dist/files/ana-garcia.html" pone "<h1 class=\"titulo-pagina\">Ana García</h1>" antes que "Bio de Ana García."
      Y el archivo "dist/files/ana-garcia.html" pone "Retrato de Ana García" antes que "Bio de Ana García."

    Escenario: La semblanza va antes que las redes
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y el proyecto produce html
      Y una creadora llamada "Ana García" con redes
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/ana-garcia.html" no dice "Semblanza"
      Y el archivo "dist/files/ana-garcia.html" dice ">Redes</span>"
      Y el archivo "dist/files/ana-garcia.html" pone "Bio de Ana García." antes que "cabecera-redes"

    Escenario: El retrato queda antes de los textos de la creadora
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y el proyecto produce html
      Y una creadora llamada "Ana García" con retrato "ana.jpg"
      Y un texto de "Ana García"
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/ana-garcia.html" pone "content-grid page-creator" antes que "Retrato de Ana García"
      Y el archivo "dist/files/ana-garcia.html" pone "Retrato de Ana García" antes que "tarjeta--fragmento"
      Y el archivo "dist/files/ana-garcia.html" dice "portada portada--front"
      Y el archivo "dist/files/ana-garcia.html" no dice "contenido-retrato"

    Escenario: Sin retrato la semblanza y los textos se apilan
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y el proyecto produce html
      Y una creadora llamada "Ana García"
      Y un texto de "Ana García"
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/ana-garcia.html" dice "content-grid page-creator"
      Y el archivo "dist/files/ana-garcia.html" pone "Bio de Ana García." antes que "tarjeta--fragmento"

    Escenario: Sin retrato la tarjeta sigue igual
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y el proyecto produce html
      Y una creadora llamada "Ana García"
      Y otra creadora llamada "Otra Autora"
      Cuando hago un build del proyecto
      Entonces el archivo "dist/files/creadora.html" no dice "Retrato de"

    Escenario: El campo image tiene que ser un texto
      Dado que la raíz del proyecto está vacía
      Cuando valido el frontmatter:
      """
      {"type":"creator","name":"Ana García","image":123}
      """
      Entonces hay 1 errores de frontmatter
      Y algún error menciona "image"

    Escenario: Si el retrato no existe se avisa y no se rompe
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y el proyecto produce html
      Y una creadora llamada "Ana García" cuyo retrato "no-existe.jpg" no existe
      Y otra creadora llamada "Otra Autora"
      Y un texto de "Ana García"
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y la salida dice "no existe"
      Y el archivo "dist/files/creadora.html" no dice "Retrato de"
