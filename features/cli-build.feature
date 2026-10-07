# language: es
Característica: El build falla bien y responde en la misma forma

  Como quien lee un error de build a las dos de la mañana
  Quiero que el error me diga qué comando resolverlo
  Para no googlear "latexmk not found" a ciegas

  # 12 de los 172 casos de `cli-layer`: 3 de `reportBuildError`, 2 de los huecos
  # transversales y 7 del humo de PDF.
  #
  # El humo de PDF es lo más caro de la suite: cada escenario compila un PDF real
  # con LaTeX. Es también lo que más regresiones ha encontrado, porque los
  # hooks de preámbulo (`tocbasic`, `eso-pic`, `pdfx`) fallan en la compilación y
  # no en ningún test de JavaScript.

  Regla de negocio: Un error de entorno dice qué comando correr

    # La diferenciación es por código estructural, no por texto: un
    # `ProcessSpawnError` o un `PandocError` de entorno siempre son "falta una
    # herramienta", y la respuesta es `doctor`. Cualquier otro error no sabe qué
    # falta, así que no manda a ningún lado — mandar a `validate` cuando el
    # problema es una herramienta ausente hace que el usuario valide un
    # proyecto sano y se vaya sin entender nada.

    Esquema del escenario: Un error de <clase> manda a doctor
      Cuando el build falla con el error <clase>
      Entonces el error dice "ejecuta 'iteraciones doctor'"

      Ejemplos:
        | clase                 |
        | pandoc-falta-entorno  |
        | comando-inexistente   |

    Escenario: Un error de entorno no manda a validate
      Cuando el build falla con el error pandoc-falta-entorno
      Entonces el error no dice "iteraciones validate"

    Escenario: Un error que no es de entorno no manda a doctor
      Cuando el build falla con el error otro
      Entonces el error no dice "iteraciones doctor"

  Regla de negocio: Un estado a medio escribir no rompe el build siguiente

    # `state.json` se escribe una sola vez al final. Si el proceso muere en
    # medio, queda truncado y el build siguiente lo lee. Lo que tiene que pasar
    # no es "no romper": es un rebuild COMPLETO, porque servir medio proyecto
    # desde un estado que no se puede leer es peor que recompilar.

    Escenario: Un estado corrupto dispara un rebuild completo
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Cuando hago un build del proyecto
      Dado que el estado del build quedó corrupto
      Y hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y la salida dice que se procesó 1 documento sin caché
      Y la salida no dice "Sin cambios"
      Y el estado del build queda completo y con schemaVersion 2

  Regla de negocio: El JSON de build tiene exactamente las claves documentadas

    # `docs/architecture.md` documenta el contrato. Un smoke test que compara el
    # conjunto de claves contra el documento convierte la documentación en algo
    # verificable: agregar `selected` al JSON sin actualizar el doc pone el
    # scenario en rojo.

    Escenario: El JSON de build no tiene claves de más ni de menos
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Cuando hago un build del proyecto pidiendo JSON
      Entonces el comando termina con el código de salida 0
      Y la salida es una sola línea
      Y el JSON declara exactamente las claves "cached, durationMs, formats, invalidations, outputDir, processed"
      Y el JSON no declara la clave "selected"
      Y el JSON declara "processed" como número
      Y el JSON declara "cached" como número
      Y el JSON declara "formats" como lista
      Y el JSON declara "invalidations" como lista
      Y el JSON declara "outputDir" como texto
      Y el JSON declara "durationMs" como número

  Regla de negocio: El PDF sale válido de extremo a extremo

    @requires-pandoc
    @requires-latex
    Escenario: Un build con índice genera un PDF real
      Dado que la raíz del proyecto tiene un proyecto con PDF y con índice
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/test-document.pdf" existe
      Y el archivo "dist/files/test-document.pdf" lleva la firma "%PDF"

      # `toc: true` ejercita el hook `\tocbasic@listhead@toc` de 17-toc-section:
      # sin él el índice no compila y el error sale de LaTeX, no de Bun.

    @requires-pandoc
    @requires-latex
    Escenario: 99-pdfx activo produce un PDF con /TrimBox
      Dado que la raíz del proyecto tiene un proyecto con 97 y 98 desactivados
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/test-document.pdf" declara "/TrimBox"
      Y el PDF pasa la certificación X-1a

    @requires-pandoc
    @requires-latex
    Escenario: 97-eso-pic activo compila sin choque de opciones
      Dado que la raíz del proyecto tiene un proyecto con 98 y 99 desactivados
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/test-document.pdf" existe

      # 30-startpaper carga `\usepackage{eso-pic}` plano mientras 97-eso-pic
      # carga el grid en runtime. Con las dos, eso-pic protestaba con
      # "Option clash for package eso-pic" (#1962).

  Regla de negocio: La portada se genera con el documento y desaparece sin él

    @requires-pandoc
    @requires-latex
    Escenario: coverImage genera la portada PNG junto al PDF
      Dado que la raíz del proyecto tiene un proyecto con portada
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/test-document.png" existe
      Y el archivo "dist/files/test-document.png" lleva la firma "PNG"

    @requires-pandoc
    @requires-latex
    Escenario: coverImage en la raíz de la configuración también funciona
      Dado que la raíz del proyecto tiene un proyecto con portada en la raíz
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/test-document.png" existe

    # #2452: la portada NO es una salida del build — la escribe `iteraciones
    # cover`. Si el build la tomara como salida esperada, un build sin cambios
    # nunca cerraría y "todo reutilizado" nunca aparecería.

    @requires-pandoc
    @requires-latex
    Escenario: Un build sin cambios con PDF no vuelve a encolar nada
      Dado que la raíz del proyecto tiene un proyecto con HTML y PDF
      Cuando hago un build del proyecto
      Y el archivo "dist/files/test-document.pdf" existe
      Y el archivo "dist/files/test-document.png" no existe
      Y hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y la salida dice "(todos reutilizados)"
      Y la salida no dice "documento modificado"

    @requires-pandoc
    @requires-latex
    Escenario: Desactivar la portada borra las PNG huérfanas
      Dado que la raíz del proyecto tiene un proyecto con portada
      Cuando hago un build del proyecto
      Y el archivo "dist/files/test-document.png" existe
      Dado que la raíz del proyecto tiene un proyecto con PDF
      Y hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/test-document.png" no existe