# language: es
Característica: el retrato de la creadora en sus tarjetas

  Como quien recorre las creadoras del sitio
  Quiero ver su retrato en la tarjeta
  Para reconocerla sin abrir su página

  Regla de negocio: La lista de creadoras muestra el retrato

    Escenario: El retrato va después del chip y antes del nombre
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y el proyecto produce html
      Y una creadora llamada "Ana García" con retrato "ana.jpg"
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/creadora.html" dice "assets/images/lista-ana"
      Y el archivo "dist/files/creadora.html" dice "width:150px;height:150px"
      Y el archivo "dist/files/creadora.html" dice "rounded-full object-cover"
      Y el archivo "dist/files/creadora.html" dice "aria-label=\"Ver la biografía de Ana García\" class=\"block overflow-hidden rounded-full"
      Y el archivo "dist/files/creadora.html" pone "Retrato de Ana García" antes que ">Ana García</a>"

    Escenario: La tarjeta de autora de un texto también lleva el retrato
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y el proyecto produce html
      Y una creadora llamada "Ana García" con retrato "ana.jpg"
      Y un texto de "Ana García"
      Cuando hago un build del proyecto
      Entonces el archivo "dist/files/un-texto-por-ana-garcia.html" dice "Retrato de Ana García"
      Y el archivo "dist/files/un-texto-por-ana-garcia.html" pone "Retrato de Ana García" antes que "class=\"text-center text-xl uppercase tracking-wide\""

    Escenario: La página de la creadora muestra el retrato como tarjeta propia
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y el proyecto produce html
      Y una creadora llamada "Ana García" con retrato "ana.jpg"
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/ana-garcia.html" dice "Retrato de Ana García"
      Y el archivo "dist/files/ana-garcia.html" dice "assets/images/ana-garcia-ana"
      Y el archivo "dist/files/ana-garcia.html" dice "rounded-tr-2xl rounded-bl-2xl"
      Y el archivo "dist/files/ana-garcia.html" pone "<div id=\"card-identity\"" antes que "assets/images/ana-garcia-ana"

    Escenario: Sin retrato la tarjeta sigue igual
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y el proyecto produce html
      Y una creadora llamada "Ana García"
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
      Y un texto de "Ana García"
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y la salida dice "no existe"
      Y el archivo "dist/files/creadora.html" no dice "Retrato de"
