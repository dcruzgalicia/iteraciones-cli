# language: es
Característica: los defaults del esquema y las vías de carga

  Como quien abre un proyecto que nunca compiló
  Quiero que el build salga con la maquetación de fábrica
  Para no tener que escribir un config entero para que funcione

  # Tramo 22 de la migración. Los 7 casos que quedaban de `config-loader.test.ts`.

  Regla de negocio: Los defaults salen del esquema, no del loader

    # Si el loader materializara sus propios valores, un cambio en `DEFAULT_*`
    # no llegaría al build y el PDF saldría con la maquetación de la versión
    # anterior. El loader no tiene constantes: las lee del esquema.

    Escenario: Los defaults del esquema son la fuente única
      Dado que la raíz del proyecto está vacía
      Y que el archivo de configuración es:
      """
      """
      Cuando cargo la configuración del proyecto
      Entonces la configuración coincide con los defaults del esquema

  Regla de negocio: Las vías de carga dan los mismos defaults

    # Un archivo vacío y un archivo mínimo tienen que producir la misma
    # maquetación. Si no, el autor que escribe `language: es-MX` obtiene un
    # PDF distinto del que no escribe nada.

    Escenario: Un archivo vacío y uno mínimo dan lo mismo
      Dado que la raíz del proyecto está vacía
      Y que el archivo de configuración es:
      """
      """
      Cuando cargo la configuración del proyecto
      Y guardo la configuración como "vacío"
      Y que el archivo de configuración es:
      """
      language: es-MX
      """
      Cuando cargo la configuración del proyecto
      Y guardo la configuración como "mínimo"
      Entonces la configuración de "mínimo" es la misma que la de "vacío"

  Regla de negocio: Una clave ausente no se materializa

    # El loader no rellena con `undefined` ni con `null`: deja la clave fuera.
    # Los consumidores resuelven el valor efectivo cuando lo necesitan, y así
    # un default del paquete puede cambiar sin que el config quede desfasado.

    Escenario: Sin clave latex, el LaTeX queda apagado
      Dado que la raíz del proyecto está vacía
      Y que el archivo de configuración es:
      """
      language: es-MX
      """
      Cuando cargo la configuración del proyecto
      # Sin la clave no hay formato que activar: el PDF no se compila.
      Entonces la configuración tiene "format.latex.generate" con el valor "false"

    Escenario: Con `format: {}` el HTML queda encendido
      Dado que la raíz del proyecto está vacía
      Y que el archivo de configuración es:
      """
      format: {}
      """
      Cuando cargo la configuración del proyecto
      # El HTML es el formato por defecto: un config que no dice nada tiene
      # que producir algo que se pueda abrir en el navegador.
      Entonces la configuración tiene "format.html.generate" con el valor "true"

    Escenario: El tema por defecto es dark
      Dado que la raíz del proyecto está vacía
      Y que el archivo de configuración es:
      """
      """
      Cuando cargo la configuración del proyecto
      Entonces la configuración tiene "format.html.site.theme" con el valor "dark"

    Escenario: El tema se puede apagar desde el config
      Dado que la raíz del proyecto está vacía
      Y que el archivo de configuración es:
      """
      format:
        html:
          site:
            theme: light
      """
      Cuando cargo la configuración del proyecto
      Entonces la configuración tiene "format.html.site.theme" con el valor "light"

    Escenario: La portada del PDF no se materializa por defecto
      Dado que la raíz del proyecto está vacía
      Y que el archivo de configuración es:
      """
      format:
        pdf:
          generate: true
      """
      Cuando cargo la configuración del proyecto
      # Sin la clave no hay portada que copiar: el campo queda fuera y el
      # consumidor resuelve el valor efectivo.
      Entonces la configuración deja "format.pdf.coverImage" sin materializar

  Regla de negocio: Una config completa se lee entera

    Escenario: Una config con todos los formatos y el vocabulario
      Dado que la raíz del proyecto está vacía
      Y que el archivo de configuración es:
      """
      language: es-MX
      format:
        latex:
          generate: true
        pdf:
          generate: true
          showDate: true
        html:
          site:
            title: Mi Sitio
            description: mi tagline
            logo: logo.svg
            theme: dark
            color: rose
          generate: true
        epub:
          generate: true
        markdown:
          generate: false
      toc: true
      disabledFilters:
        - semantic/string/01-double-colon
      """
      Cuando cargo la configuración del proyecto
      Entonces la configuración tiene "format.html.site.title" con el valor "Mi Sitio"
      Y la configuración tiene "format.html.site.description" con el valor "mi tagline"
      Y la configuración tiene "language" con el valor "es-MX"
      Y la configuración tiene "format.html.site.logo" con el valor "logo.svg"
      Y la configuración tiene "format.latex.generate" con el valor "true"
      Y la configuración tiene "format.pdf.generate" con el valor "true"
      Y la configuración tiene "format.pdf.showDate" con el valor "true"
      Y la configuración tiene "toc" con el valor "true"
      Y la configuración tiene "format.html.generate" con el valor "true"
      Y la configuración tiene "format.html.site.theme" con el valor "dark"
      Y la configuración tiene "format.html.site.color" con el valor "rose"
      Y la configuración tiene "format.epub.generate" con el valor "true"
      Y la configuración tiene "format.markdown.generate" con el valor "false"
      Y la configuración tiene "disabledFilters" con el valor "semantic/string/01-double-colon"
