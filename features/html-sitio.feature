# language: es
Característica: los enlaces del sitio y el índice paginado de una colección

  Regla de negocio: Los enlaces del proyecto generan tarjetas de «Redes»

    Escenario: Con enlaces hay una tarjeta después del header y otra antes del footer
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y el sitio declara los enlaces:
      """
      Mastodon | https://mastodon.social/@iteraciones
      GitHub | https://github.com/dcruzgalicia
      """
      Cuando hago un build del proyecto
      Entonces el archivo "dist/files/test-document.html" dice "Redes"
      Y el archivo "dist/files/test-document.html" dice 'target="_blank"'
      Y las tarjetas de Redes van después del header y antes del footer
      Y las tarjetas de Redes llevan el chip del sitio "Test"

  Regla de negocio: Las redes de la creadora van en su tarjeta

    Escenario: La creadora con enlaces tiene su tarjeta con su nombre
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y un proyecto con una creadora con redes
      Cuando hago un build del proyecto
      Entonces el HTML de "ana-ruiz.html" tiene la tarjeta de redes de "Ana Ruiz"
      Y el HTML de "ana-ruiz.html" contiene "https://instagram.com/ana"
      Y el cuerpo de "ana-ruiz.html" no lleva las redes en negritas
      Y los enlaces de la tarjeta de redes de "ana-ruiz.html" abren en otra pestaña

    Escenario: La creadora sin enlaces no tiene tarjeta de redes
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y un proyecto con una creadora con redes
      Cuando hago un build del proyecto
      Entonces el HTML de "sin-redes.html" sólo tiene las redes del sitio

  Regla de negocio: Los espacios no separables son cosa del PDF

    Escenario: En HTML y Markdown el &nbsp; es un espacio normal
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y un proyecto con un &nbsp; en el texto
      Cuando hago un build del proyecto
      Entonces el HTML de "ensayo.html" contiene "Un texto unido y otro pegado."
      Y el HTML de "ensayo.md" contiene "Un texto unido y otro pegado."

  Regla de negocio: Los enlaces se subrayan sólo al pasar el ratón

    Escenario: Ningún enlace del sitio va subrayado por defecto
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y el proyecto produce html
      Cuando hago un build del proyecto
      Entonces ningún enlace del HTML lleva "underline" por defecto

  Regla de negocio: La tarjeta de identidad enlaza por separado

    Escenario: El logo y el nombre enlazan, la descripción no
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y el proyecto produce html
      Cuando hago un build del proyecto
      Entonces la tarjeta de identidad no es un enlace
      Y el logo y el nombre enlazan al inicio
      Y la descripción no es un enlace

  Regla de negocio: Los enlaces de Formatos abren en otra pestaña

    Escenario: Los formatos disponibles no se llevan al lector fuera del sitio
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y el proyecto produce html y markdown
      Cuando hago un build del proyecto
      Entonces los enlaces de Formatos abren en otra pestaña

  Regla de negocio: El índice de una colección se pagina con sus textos

    Escenario: Con más de 10 textos el índice enlaza la página siguiente
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y una colección con 15 textos
      Y el proyecto tiene toc activo
      Cuando hago un build del proyecto
      Entonces el índice de la página 1 de la colección lista 10 textos
      Y el índice de la página 1 enlaza el índice de la página 2
      Y el índice de la página 2 de la colección lista 5 textos
      Y el índice de la página 2 enlaza el índice de la página 1
