# language: es
Característica: la configuración del proyecto

  Como quien escribe su `iteraciones.config.yaml`
  Quiero que lo que escribo se lea tal cual y que lo que no escribo use el
  valor por defecto
  Para no tener que descubrir los valores de memoria ni ver un error por una
  clave que el esquema ya no tiene

  Regla de negocio: Lo que el autor escribió se lee tal cual

    Esquema del escenario: Una clave del archivo llega a la configuración
      Dado que el archivo de configuración es:
      """
      <yaml>
      """
      Cuando cargo la configuración del proyecto
      Entonces la carga no falla
      Y la configuración tiene "<ruta>" con el valor "<valor>"

      Ejemplos:
        | yaml                                              | ruta                        | valor                   |
        | format: { html: { site: { title: Mi Título } } }   | format.html.site.title      | Mi Título             |
        | format: { html: { site: { description: Hola } } } | format.html.site.description| Hola                  |
        | language: en-US                                   | language                   | en-US                 |
        | format: { html: { site: { logo: logo.png } } }    | format.html.site.logo      | logo.png              |
        | disabledFilters: [15-hyphenation-rules]            | disabledFilters            | 15-hyphenation-rules      |
        | disabledPreambleFilters: [97-eso-pic]              | disabledPreambleFilters    | 97-eso-pic               |
        | luaFilters: [mi-filtro.lua]                        | luaFilters                 | mi-filtro.lua            |
        | format: { latex: { generate: true } }              | format.latex.generate      | true                    |
        | format: { latex: { generate: false } }             | format.latex.generate      | false                   |
        | format: { html: { generate: true } }               | format.html.generate       | true                    |
        | format: { pdf: { generate: true } }                | format.pdf.generate        | true                    |
        | format: { epub: { generate: true } }               | format.epub.generate       | true                    |
        | format: { markdown: { generate: true } }           | format.markdown.generate   | true                    |
        | format: { html: { blocks: [header, indice] } }    | format.html.blocks         | header, indice           |
        | bibliography: refs.bib                              | bibliography               | refs.bib              |
        | csl: estilos/apa.csl                                | csl                        | estilos/apa.csl       |

  Regla de negocio: Una clave ausente no se materializa

    Escenario: Una lista vacía de filtros desactivados se lee como lista vacía
      Dado que el archivo de configuración es:
      """
      disabledFilters: []
      """
      Cuando cargo la configuración del proyecto
      Entonces la carga no falla
      Y la configuración deja "disabledFilters" sin materializar

    Escenario: Poner el PDF no materializa los campos que son suyos
      Dado que el archivo de configuración es:
      """
      format:
        pdf:
          generate: true
      """
      Cuando cargo la configuración del proyecto
      Entonces la carga no falla
      Y la configuración tiene "format.pdf.generate" con el valor "true"
      Y la configuración deja "format.pdf.showDate" sin materializar
      Y la configuración deja "format.pdf.disabledPreambleFilters" sin materializar
      Y la configuración tiene "toc" con el valor "false"

  Regla de negocio: Un config que no existe se dice, no se rellena

    Escenario: Sin archivo de configuración el build se para
      Dado que el proyecto no tiene archivo de configuración
      Cuando cargo la configuración del proyecto
      Entonces la carga falla diciendo que:
      """
      ejecuta 'iteraciones init'
      """
      Y la carga falla con "un archivo vacío usa los valores por defecto"

    Escenario: Sin archivo, la carga opcional devuelve nada
      Dado que el proyecto no tiene archivo de configuración
      Cuando cargo la configuración si existe
      Entonces no hay archivo de configuración

    Escenario: Sin archivo, la carga con presencia también falla
      Dado que el proyecto no tiene archivo de configuración
      Cuando cargo la configuración con el conjunto de presencia
      Entonces la carga falla con "iteraciones"

  Regla de negocio: Un archivo vacío o inerte usa los valores por defecto

    Escenario: Un archivo vacío devuelve los defaults
      Dado que el archivo de configuración es:
      """
      """
      Cuando cargo la configuración del proyecto
      Entonces la carga no falla
      Y la configuración tiene "language" con el valor "es-MX"

    Escenario: Un archivo vacío tiene el conjunto de presencia vacío
      Dado que el archivo de configuración es:
      """
      """
      Cuando cargo la configuración con el conjunto de presencia
      Entonces la carga no falla
      Y el conjunto de presencia está vacío
      Y la configuración tiene "language" con el valor "es-MX"

    Escenario: Un YAML que no es un objeto se ignora con aviso
      Dado que el archivo de configuración es:
      """
      hola mundo
      """
      Cuando cargo la configuración del proyecto
      Entonces la carga no falla
      Y la configuración tiene "language" con el valor "es-MX"
      Y la configuración avisa que "no es un objeto YAML"

  Regla de negocio: El autor ve los errores de tipo en español y todos juntos

    Escenario: Un YAML con sintaxis rota se explica en español
      Dado que el archivo de configuración es:
      """
      format:
        html:
          site:
            title: ok
       language: es-MX
      """
      Cuando cargo la configuración del proyecto
      Entonces la carga falla con "indentación inconsistente"

    Escenario: Todos los errores de tipo salen en una sola ejecución
      Dado que el archivo de configuración es:
      """
      language: 123
      format:
        html:
          site:
            theme: raro
        pdf:
          pageNumber: medio
      """
      Cuando cargo la configuración del proyecto
      Entonces la carga falla con "language: se esperaba string, se recibió 123"
      Y la carga falla con "format.html.site.theme"
      Y la carga falla con "format.pdf.pageNumber"

  Regla de negocio: Una clave que el esquema ya no tiene es un error

    Escenario: Una clave de PDF que ya no existe es un error
      Dado que el archivo de configuración es:
      """
      format:
        pdf:
          mathptmx: true
          generate: true
      """
      Cuando cargo la configuración del proyecto
      Entonces la carga falla con "claves desconocidas"
      Y la carga falla con "format.pdf"
      Y la carga falla con "mathptmx"

    Escenario: Una clave inventada en la raíz es un error
      Dado que el archivo de configuración es:
      """
      clave-inventada: 1
      format:
        html:
          site:
            title: ok
      """
      Cuando cargo la configuración del proyecto
      Entonces la carga falla con "clave-inventada"

    Escenario: El accent inválido no cae a lime en silencio
      Dado que el archivo de configuración es:
      """
      format:
        html:
          site:
            color: color-inventado
      """
      Cuando cargo la configuración del proyecto
      Entonces la carga falla con "valor no válido"

    Escenario: Un bloque de HTML que no existe es un error accionable
      Dado que el archivo de configuración es:
      """
      format:
        html:
          blocks:
            - tarjeta-rara
      """
      Cuando cargo la configuración del proyecto
      Entonces la carga falla con "no es un bloque conocido"

    Escenario: La sintaxis antigua de blocks es un error accionable
      Dado que el archivo de configuración es:
      """
      format:
        html:
          blocks:
            formatos: 4
      """
      Cuando cargo la configuración del proyecto
      Entonces la carga falla con "debe ser una lista de bloques"

    Escenario: El booleano antiguo `latex: true` es un error de tipo
      Dado que el archivo de configuración es:
      """
      format:
        latex: true
      """
      Cuando cargo la configuración del proyecto
      Entonces la carga falla con "format.latex: se esperaba object, se recibió true"

  Regla de negocio: El conjunto de presencia separa lo escrito de lo puesto

    Escenario: Una clave escrita con el valor del default sí cuenta como escrita
      Dado que el archivo de configuración es:
      """
      format:
        pdf:
          disabledPreambleFilters:
            - 97-eso-pic
      """
      Cuando cargo la configuración con el conjunto de presencia
      Entonces la carga no falla
      Y la clave "format.pdf.disabledPreambleFilters" está en el conjunto de presencia
      Y la configuración tiene "format.pdf.disabledPreambleFilters" con el valor "97-eso-pic"

    Escenario: Una clave ausente no cuenta
      Dado que el archivo de configuración es:
      """
      language: es-MX
      """
      Cuando cargo la configuración con el conjunto de presencia
      Entonces la carga no falla
      Y la clave "format.pdf.disabledPreambleFilters" NO está en el conjunto de presencia
      Y la configuración deja "format.pdf.disabledPreambleFilters" sin materializar

    Escenario: El conjunto recoge las rutas punteadas de todos los niveles
      Dado que el archivo de configuración es:
      """
      language: en-US
      format:
        pdf:
          generate: true
          showDate: true
      """
      Cuando cargo la configuración con el conjunto de presencia
      Entonces la clave "language" está en el conjunto de presencia
      Y la clave "format" está en el conjunto de presencia
      Y la clave "format.pdf" está en el conjunto de presencia
      Y la clave "format.pdf.generate" está en el conjunto de presencia
      Y la clave "format.pdf.showDate" está en el conjunto de presencia
      Y la clave "format.pdf.disabledPreambleFilters" NO está en el conjunto de presencia

  Regla de negocio: Una configuración válida no produce avisos

    Escenario: Nada que avisar en una config que se puede usar
      Dado que el archivo de configuración es:
      """
      language: es-MX
      toc: true
      format:
        html:
          generate: true
        pdf:
          generate: true
      """
      Cuando cargo la configuración del proyecto
      Entonces la carga no falla
      Y la carga no avisa nada