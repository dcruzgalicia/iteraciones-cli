# language: es
Característica: validate revisa el proyecto y dice qué corregir

  Como quien escribe y no quiere que pandoc le cobre el error a mitad del build
  Quiero que validate me diga qué está mal, en español, con el archivo y la línea
  Para arreglarlo antes de compilar

  Regla de negocio: Sin configuración, validate sugiere init

    Escenario: Un proyecto con documentos pero sin configuración
      Dado que la raíz del proyecto tiene un documento pero no la configuración
      Cuando corro "validate"
      Entonces el comando termina con el código de salida 1
      Y el error dice "falta el archivo de configuración"
      Y el error dice "ejecuta 'iteraciones init'"

  Regla de negocio: Un proyecto bien formado pasa

    Escenario: Una configuración válida con documentos con frontmatter
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Cuando corro "validate"
      Entonces el comando termina con el código de salida 0
      Y la salida dice "sin errores"

  Regla de negocio: Una configuración sin documentos sugiere init

    Escenario: Una configuración sin documentos
      Dado que la raíz del proyecto está vacía
      Dado que el archivo "iteraciones.config.yaml" tiene este contenido
      """
      language: es-MX
      """
      Cuando corro "validate"
      Entonces el comando termina con el código de salida 0
      Y la salida dice "ejecuta 'iteraciones init'"

  Regla de negocio: Un documento sin contenido es un error

    Escenario: Un documento con frontmatter pero sin cuerpo
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Dado que el archivo "vacio.md" tiene este contenido
      """
      ---
      title: Vacío
      ---
      """
      Cuando corro "validate"
      Entonces el comando termina con el código de salida 1
      Y el error dice "vacio.md"
      Y el error dice "no tiene contenido después del frontmatter; agrega un body para proceder con el build"

    Escenario: Un documento completamente vacío
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Dado que el archivo "hueco.md" está vacío
      Cuando corro "validate"
      Entonces el comando termina con el código de salida 1
      Y el error dice "hueco.md"
      Y el error dice "documento vacío; agrega un body para proceder con el build"

  Regla de negocio: Falta el título es un aviso, no un error

    Escenario: Tres formas de no tener título
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Dado que el archivo "sin-fm.md" tiene este contenido
      """
      Solo contenido, sin frontmatter.
      """
      Dado que el archivo "sin-clave.md" tiene este contenido
      """
      ---
      date: 2026-01-01
      ---

      Contenido.
      """
      Dado que el archivo "titulo-vacio.md" tiene este contenido
      """
      ---
      title: ""
      ---

      Contenido.
      """
      Cuando corro "validate"
      Entonces el comando termina con el código de salida 0
      Y el error dice 'sin-fm.md: no tiene título en el frontmatter; se usará "Sin título"'
      Y el error dice 'sin-clave.md: no tiene título en el frontmatter; se usará "Sin título"'
      Y el error dice 'titulo-vacio.md: no tiene título en el frontmatter; se usará "Sin título"'

  Regla de negocio: La configuración inválida se informa traducida

    Escenario: Una configuración con una lista sin cerrar
      Dado que la raíz del proyecto está vacía
      Dado que el archivo "iteraciones.config.yaml" tiene el contenido "format: [mal formado"
      Cuando corro "validate"
      Entonces el comando termina con el código de salida 1
      Y el error dice "Error de sintaxis"

    Escenario: Una configuración con un valor sin cerrar
      Dado que la raíz del proyecto está vacía
      Dado que el archivo "iteraciones.config.yaml" tiene el contenido "language: [invalido"
      Cuando corro "validate"
      Entonces el comando termina con el código de salida 1
      Y el error dice "Error de sintaxis"

    Escenario: Una configuración con la indentación inconsistente
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Dado que el archivo "iteraciones.config.yaml" tiene este contenido
      """
      format:
        html: true
       latex:
        generate: true
      """
      Cuando corro "validate"
      Entonces el error dice "iteraciones.config.yaml: Error de sintaxis: los items del mapeo"
      Y el error dice "línea 3, columna"
      Y el error no dice "All mapping items"
      Y el error menciona "iteraciones.config.yaml" una sola vez

  Regla de negocio: Un tipo incorrecto en un campo conocido es un error

    Escenario: El título con un número donde va texto
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Dado que el documento "malo.md" tiene el frontmatter "title: 123"
      Cuando corro "validate"
      Entonces el comando termina con el código de salida 1
      Y el error dice "malo.md"
      Y el error dice '"title" debe ser un texto'

    Escenario: El creator con un número donde va texto
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Dado que el archivo "malo.md" tiene este contenido
      """
      ---
      title: "Ok"
      creator: 5
      ---

      # Hola
      """

      Cuando corro "validate"
      Entonces el comando termina con el código de salida 1
      Y el error dice '"creator" debe ser un texto o una lista de textos'

  Regla de negocio: Un frontmatter dudoso avisa sin bloquear

    Escenario: Una fecha que no es ISO
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Dado que el archivo "malo.md" tiene este contenido
      """
      ---
      title: "Ok"
      date: "no-es-fecha"
      ---

      # Hola
      """
      Cuando corro "validate"
      Entonces el comando termina con el código de salida 0
      Y el error dice '"date" no usa el formato ISO YYYY-MM-DD'

    Escenario: Un frontmatter sin cerrar
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Dado que el archivo "abierto.md" tiene este contenido
      """
      ---
      title: "x"

      # Hola
      """
      Cuando corro "validate"
      Entonces el comando termina con el código de salida 0
      Y el error dice "frontmatter sin cerrar"

    Escenario: Una ":" suelta en el cuerpo
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Dado que el archivo "suelta.md" tiene este contenido
      """
      ---
      title: "Ok"
      ---

      texto

      :

      texto
      """
      Cuando corro "validate"
      Entonces el comando termina con el código de salida 0
      Y el error dice "suelta.md"
      Y el error dice 'línea 7 con ":" suelta'
      Y el error dice '"::" (espacio vertical) o ":;" (sin indentación)'

  Regla de negocio: El vocabulario correcto cierra en silencio

    Escenario: El vocabulario de pandoc no avisa
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Dado que el archivo "limpio.md" tiene este contenido
      """
      ---
      title: "Ok"
      ---

      texto

      ::

      texto

      :;

      texto

      ::: {.dictum}
      Cita
      :::
      """
      Cuando corro "validate"
      Entonces el comando termina con el código de salida 0
      Y el error no dice 'con ":" suelta'
      Y la salida dice "sin errores"

  Regla de negocio: El resumen cuenta los errores con el plural correcto

    Escenario: El resumen usa el singular con un solo error
      Dado que la raíz del proyecto está vacía
      Dado que el archivo "iteraciones.config.yaml" tiene este contenido
      """
      language: [inválido
      """
      Cuando corro "validate"
      Entonces el error dice "✖ [validate] 1 error:"
      Y el error no dice "error(es)"
      Y el error no dice "se encontraron"
      Y el error no dice "errors:"

    Escenario: El resumen usa el plural con dos errores
      Dado que la raíz del proyecto está vacía
      Dado que el archivo "iteraciones.config.yaml" tiene este contenido
      """
      language: [inválido
      """
      Dado que el documento "a.md" tiene el frontmatter sin cerrar
      Cuando corro "validate"
      Entonces el comando termina con el código de salida 1
      Y el error dice "2 errores"

  Regla de negocio: Un error no tapa los demás

    Escenario: Un accent inválido no oculta los demás errores
      Dado que la raíz del proyecto está vacía
      Dado que el archivo "iteraciones.config.yaml" tiene este contenido
      """
      language: 123
      format:
        html:
          site:
            color: naranja
      """
      Cuando corro "validate"
      Entonces el comando termina con el código de salida 1
      Y el error dice "color"
      Y el error dice "language"

  Regla de negocio: Los campos de frontmatter que nadie lee se avisan

    Escenario: Un campo de frontmatter desconocido
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Dado que el archivo "extra.md" tiene este contenido
      """
      ---
      title: Extra
      abstract: Resumen del trabajo
      custom-field: valor
      ---

      Contenido.
      """
      Cuando corro "validate"
      Entonces el comando termina con el código de salida 0
      Y el error dice "campos de frontmatter ignorados por el pipeline: custom-field"
      Y el error dice "extra.md"

    Escenario: Los campos que llegan a pandoc no se avisan
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Dado que el documento "efectivos.md" declara varios campos efectivos
      Cuando corro "validate"
      Entonces el comando termina con el código de salida 0
      Y el error no dice "campos de frontmatter ignorados"

    Escenario: Un proyecto sin campos desconocidos no avisa
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Cuando corro "validate"
      Entonces el comando termina con el código de salida 0
      Y el error no dice "ignorados"

  Regla de negocio: Las rutas de la configuración tienen que existir

    Escenario: Una bibliografía que no está en el proyecto
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Dado que la configuración declara la clave "bibliography" con el valor "refs/no-existe.bib"
      Cuando corro "validate"
      Entonces el comando termina con el código de salida 1
      Y el error dice 'bibliography: "refs/no-existe.bib" no encontrado en el proyecto'

    Escenario: Desactivar 05-language sin 16-toc-styling
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Dado que la configuración desactiva un filtro del preámbulo "05-language"
      Cuando corro "validate"
      Entonces el comando termina con el código de salida 1
      Y el error dice "16-toc-styling usa"

  Regla de negocio: validate --json responde en la misma forma

    Escenario: Un proyecto válido sale como JSON
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Cuando valido el proyecto pidiendo JSON
      Entonces el comando termina con el código de salida 0
      Y el JSON declara la clave "ok" con el valor verdadero
      Y el JSON declara la clave "documents" con el número 1
      Y el JSON no declara errores

    Escenario: Un error de frontmatter sale estructurado
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Dado que el documento "bad.md" tiene el frontmatter sin cerrar
      Cuando valido el proyecto pidiendo JSON
      Entonces el comando termina con el código de salida 1
      Y el JSON declara la clave "ok" con el valor falso
      Y el JSON declara al menos 1 error
      Y el primer error es del archivo "bad.md"
      Y el primer error dice "frontmatter YAML inválido"

    Escenario: Un filtro desactivado que no existe aparece una sola vez
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Dado que la configuración desactiva un filtro global "filtro-que-no-existe"
      Cuando valido el proyecto pidiendo JSON
      Entonces el JSON declara exactamente 1 aviso que menciona "filtro-que-no-existe"
      Y ese aviso viene del archivo "config"