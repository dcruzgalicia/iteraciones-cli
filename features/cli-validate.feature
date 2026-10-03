# language: es
Característica: validate revisa el proyecto y dice qué corregir

  Como quien escribe y no quiere que pandoc le cobre el error a mitad del build
  Quiero que validate me diga qué está mal, en español, con el archivo y la línea
  Para arreglarlo antes de compilar

  # 24 de los 172 casos de `cli-layer`: los 21 de `runValidate` más los 3 de
  # `validate --json`.
  #
  # La mitad son avisos que NO rompen el código de salida, y esa es la parte
  # valiosa: `validate` distingue "esto no compila" de "esto compila pero te va a
  # salir raro". Un test que sólo mira el código de salida no vería la diferencia.

  Regla de negocio: Sin configuración, validate sugiere init

    # #2071: sin `iteraciones.config.yaml` el build no arranca. El mensaje tiene
    # que decir qué hacer, no nombrar el archivo que falta y ya.

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

    # #2089: sale con 0. No hay nada que validar todavía, así que no es un
    # error — pero un proyecto recién creado sí quiere un documento.

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

    # #2463: el frontmatter solo no alcanza. El build falla más tarde con un
    # error de pandoc que no dice qué documento es, así que validate lo atrapa
    # acá y nombra el archivo.

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

    # Tres formas distintas de no tener título y el mismo aviso. El build sigue
    # con "Sin título": es un default razonable, no un motivo para bloquear.

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

    # La causa de `yaml` viene en inglés ("All mapping items must start at the
    # same column"). El usuario lee español.

    # Dos escenarios y no una tabla: `check-steps` aproxima las tablas de
    # `Ejemplos` mezclando las filas de todas las del feature (está anotado en
    # el propio checker), así que un placeholder de una tabla que no es la
    # última se reporta como indefinido. Dos escenarios planos son menos
    # ceremonia que un checker nuevo.

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

    # Éste no puede ser una tabla: el contenido necesita la indentación
    # inconsistente que provoca el error, y una celda de tabla no puede ocupar
    # varias líneas.

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

    # El paso de arriba armaba `---\ntitle: "Ok"\n<clave>: <valor>\n---`. Con
    # la clave `title` eso es la misma clave dos veces, y el validador reportaba
    # "las claves del mapeo deben ser únicas": el escenario pasaba, pero por el
    # motivo equivocado. Por eso el paso recibe el frontmatter entero.

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

    # Los tres casos de acá salen con 0: son cosas que el build tolera pero que
    # el autor querría saber. Una fecha mal escrita rompe la bibliografía, un
    # frontmatter sin cerrar se ignora en silencio, y una ":" suelta es casi
    # siempre un `::` mal escrito.

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

    # El caso del medio entre la ":" suelta y el frontmatter roto. `::`, `;` y
    # los divs con vallas son sintaxis válida: si acá saltara un aviso, el de la
    # regla anterior sería ruido y el usuario dejaría de leerlos.

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
      Y el error dice "✖ [validate] 1 error:"
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

    # El `accent` inválido es el último campo de un objeto anidado. El validador
    # cortaba en el primer error de tipo y se comía el resto de la config: el
    # usuario arreglaba uno, corría, y aparecía el siguiente. Tres corridas
    # para arreglar tres líneas.

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

    # El pipeline se traga `abstract` y `custom-field` en silencio. Callarse es
    # peor: el autor escribe un campo, cree que hace algo, y no hace nada.

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

    # Los ocho campos de acá SÍ llegan a pandoc o a la plantilla. Avisar sobre
    # ellos sería el mismo ruido que avisar sobre un campo desconocido.

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

    # 05-language inyecta el idioma en el documento; 16-toc-styling es lo que
    # escribe el encabezado de la tabla de contenido. Desactivar el primero sin
    # el segundo deja una `\tableofcontents` sin estilo — no un error visible,
    # un documento feo. El validador lo ve en la config, antes de compilar.

    Escenario: Desactivar 05-language sin 16-toc-styling
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Dado que la configuración desactiva un filtro del preámbulo "05-language"
      Cuando corro "validate"
      Entonces el comando termina con el código de salida 1
      Y el error dice "16-toc-styling usa"

  Regla de negocio: validate --json responde en la misma forma

    # Un editor o un watcher necesita leer el resultado sin parsear texto. Por eso
    # el caso de arriba exige que `stdout` traiga "sin errores" y este exige que
    # traiga el documento: en los dos, `stdout` es una sola cosa.

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

    # #2234: el filtro desactivado que no existe salía como aviso en el texto Y
    # en el JSON, y el consumidor lo contaba dos veces. Un JSON con duplicados
    # es peor que un JSON sin el aviso.

    Escenario: Un filtro desactivado que no existe aparece una sola vez
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Dado que la configuración desactiva un filtro global "filtro-que-no-existe"
      Cuando valido el proyecto pidiendo JSON
      Y el JSON declara exactamente 1 aviso que menciona "filtro-que-no-existe"
      Y ese aviso viene del archivo "config"