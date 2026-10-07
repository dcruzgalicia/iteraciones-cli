# language: es
Característica: build y validate dicen lo mismo

  Como quien lee un error de build y después corre validate
  Quiero que los dos comandos usen las mismas palabras
  Para no tener que aprender el problema dos veces

  Regla de negocio: El frontmatter roto se reporta con contexto

    Escenario: Un frontmatter con sintaxis rota
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Dado que el archivo "roto.md" tiene este contenido
      """
      ---
      title: "Roto"
      invalid: [unclosed
      ---

      Contenido.
      """
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 1
      Y el error dice "✖ [build] frontmatter YAML inválido en 1 documento:"
      Y el error dice "roto.md:"
      Y el error dice "ejecuta 'iteraciones validate' para más detalle"

    Escenario: Un frontmatter roto aborta antes de invocar pandoc
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Dado que el archivo "roto.md" tiene este contenido
      """
      ---
      title: "Roto"
      invalid: [unclosed
      ---

      Contenido.
      """
      Dado que espío las invocaciones de pandoc
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 1
      Y pandoc no fue invocado

    Escenario: Un título numérico es un error de build
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Dado que el documento "malo.md" tiene el frontmatter "title: 123"
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 1
      Y el error dice "malo.md"
      Y el error dice "debe ser un texto (string), se recibió number"
      Y el error dice "✖ [build] frontmatter inválido en 1 documento:"
      Y el error no dice "frontmatter YAML inválido"
      Y el error no dice "ejecuta 'iteraciones validate'"
      Y el error no dice "no tiene título"

    Escenario: Sintaxis rota y campos inválidos se separan por clase
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Dado que el archivo "roto.md" tiene este contenido
      """
      ---
      title: "sin cerrar
      ---

      Contenido.
      """
      Dado que el documento "malo.md" tiene el frontmatter "title: 123"
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 1
      Y el error dice "✖ [build] frontmatter YAML inválido en 1 documento:"
      Y el error dice "roto.md:"
      Y el error dice "frontmatter inválido en 1 documento:"
      Y el error dice "malo.md:"
      Y el error dice "ejecuta 'iteraciones validate'"

  Regla de negocio: Un error de pandoc no manda a validate

    Escenario: Un filtro lua con sintaxis rota
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Dado que el archivo "iteraciones.config.yaml" tiene este contenido
      """
      language: es-MX
      luaFilters: [filters/roto.lua]
      """
      Dado que el archivo "filters/roto.lua" tiene este contenido
      """
      function ) sintaxis inválida
      """
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 1
      Y el error no dice "ejecuta 'iteraciones validate'"

  Regla de negocio: Los errores de configuración nombran el campo

    Escenario: Un pageNumber inválido
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Dado que el archivo "iteraciones.config.yaml" tiene este contenido
      """
      language: es-MX
      format:
        pdf:
          generate: true
          pageNumber: raro
      """
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 1
      Y el error dice "✖ [config] format.pdf.pageNumber"
      Y el error no muestra un stack trace
      Y el error no dice ".ts:"

    Escenario: Una bibliografía inexistente
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Dado que el archivo "iteraciones.config.yaml" tiene este contenido
      """
      bibliography: refs/no-existe.bib
      """
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 1
      Y build y validate dicen 'bibliography: "refs/no-existe.bib" no encontrado en el proyecto'

    Escenario: Una clave desconocida en la configuración
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Dado que el archivo "iteraciones.config.yaml" tiene este contenido
      """
      clave-inventada: 1
      """
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 1
      Y el error dice "claves desconocidas"
      Y el error dice "clave-inventada"

  Regla de negocio: build sin configuración sugiere init

    Escenario: Un proyecto con documentos pero sin configuración
      Dado que la raíz del proyecto tiene un documento pero no la configuración
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 1
      Y el error dice "falta el archivo de configuración"
      Y el error dice "ejecuta 'iteraciones init'"

  Regla de negocio: Los avisos son los mismos en los dos comandos

    Escenario: Un filtro lua inexistente avisa una sola vez
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Dado que el archivo "iteraciones.config.yaml" tiene este contenido
      """
      language: es-MX
      luaFilters: [filters/no-existe.lua]
      """
      Entonces build y validate dicen "no encontrado en el proyecto" exactamente una vez

    Escenario: Una fecha que no es ISO
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Dado que el archivo "test.md" tiene este contenido
      """
      ---
      title: Ok
      date: 2026/01/01
      campo-raro: x
      ---

      Contenido.
      """
      Entonces build y validate dicen 'date" no usa el formato ISO'
      Y build y validate dicen "campos de frontmatter ignorados"
      Y el build termina con el código de salida 0
      Y validate termina con el código de salida 0

    Escenario: Una ":" suelta en el cuerpo
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Dado que el archivo "suelta.md" tiene este contenido
      """
      ---
      title: Ok
      ---

      texto

      :

      texto
      """
      Entonces build y validate dicen 'línea 7 con ":" suelta'
      Y build y validate dicen '"::" (espacio vertical) o ":;" (sin indentación)'

    Escenario: Un documento sin título
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Dado que el archivo "sin-titulo.md" tiene este contenido
      """
      ---
      date: 2026-01-01
      ---

      Contenido.
      """
      Entonces build y validate dicen 'no tiene título en el frontmatter; se usará "Sin título"'

  Regla de negocio: Sin pandoc el build aborta al principio

    Escenario: pandoc no está en el PATH
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Dado que pandoc no está disponible
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 1
      Y el error dice "pandoc no está disponible en PATH"
      Y el error dice "https://pandoc.org/installing.html"