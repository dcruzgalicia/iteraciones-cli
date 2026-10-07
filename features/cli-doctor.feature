# language: es
Característica: doctor y list-filters cuentan qué le falta al proyecto

  Como quien acaba de instalar el CLI o demudarse de máquina
  Quiero que doctor me diga qué falta y qué no, y que no me haga correr
  verificaciones que no van con mi proyecto
  Para no perder la tarde instalando un motor LaTeX para un proyecto de HTML

  # 22 de los 172 casos de `cli-layer`: 8 de `runDoctor`, 5 de `doctor --info`,
  # 5 de `runFilters` y 4 del bloque condicionado al proyecto.
  #
  # La idea que atraviesa el bloque: un check que no aplica es RUIDO. `doctor`
  # sobre un proyecto de HTML que igual ofrece instalar pdflatex hace que el
  # usuario lea la lista y no sepa cuál le importa.

  Regla de negocio: doctor sólo verifica lo que el proyecto usa

    @requires-pandoc
    Escenario: Un proyecto de HTML no ofrece instalar pdflatex
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Cuando corro "doctor"
      Entonces el comando termina con el código de salida 0
      Y la salida no dice "pdflatex"

    Escenario: Un proyecto con PDF sí verifica el motor LaTeX
      Dado que la raíz del proyecto tiene un proyecto con PDF
      Cuando corro "doctor"
      Entonces la salida dice "pdflatex disponible"

    # #2082: un proyecto HTML-only que ofrece `iteraciones-pdfcheck`,
    # `ImageMagick` o `biber` hace que el usuario instale tres herramientas
    # que no necesita. Un check que no aplica es ruido.

    @requires-pandoc
    Escenario: Un proyecto de HTML no lista los checks de PDF
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Cuando corro "doctor"
      Entonces la salida no dice "iteraciones-pdfcheck"
      Y la salida no dice "ImageMagick"
      Y la salida no dice "biber"

    # #2184: `biber` sólo se verifica si hay una bibliografía. El criterio es el
    # mismo que usa `resolveBibOptions`: auto-descubrimiento cuando la config no
    # declara nada.

    Escenario: El check de biber depende de que haya bibliografía
      Dado que la raíz del proyecto tiene un proyecto con PDF
      Cuando corro "doctor"
      Entonces la salida no dice "biber disponible"
      Dado que el proyecto tiene el archivo "refs.bib"
      Y corro "doctor"
      Y la salida dice "biber disponible"

    # La certificación PDF/X-1a sólo se ofrece si el filtro 99-pdfx está activo,
    # porque sin él el PDF no lleva los boxes y no hay nada que certificar.

    Escenario: El check de certificación depende de 99-pdfx
      Dado que la raíz del proyecto tiene un proyecto con PDF
      Cuando corro "doctor"
      Entonces la salida no dice "iteraciones-pdfcheck"

    Escenario: Con 99-pdfx activo aparece el check de certificación
      Dado que la raíz del proyecto tiene un proyecto con 99-pdfx activo
      Cuando corro "doctor"
      Entonces la salida dice "iteraciones-pdfcheck"

  Regla de negocio: Un check opcional que falla avisa pero no rompe

    # `pdftoppm` sólo hace falta para rasterizar. Si falta, el aviso dice cómo
    # instalarlo y `doctor` sigue con 0: el proyecto se puede construir igual.
    # Si `doctor` saliera con 1, el usuario interpretaría que no puede trabajar.

    Escenario: pdftoppm ausente se avisa con cómo instalarlo
      Dado que pdftoppm no está disponible
      Dado que la raíz del proyecto tiene un proyecto con PDF
      Cuando corro "doctor"
      Entonces el comando termina con el código de salida 0
      Y la salida dice "⚠ pdftoppm disponible"
      Y la salida dice "Instala poppler"

  Regla de negocio: Cada check se renderiza con su marca y sin escapes

    Escenario: Los checks que pasan salen con ✔
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Cuando corro "doctor"
      Entonces la salida dice "✔ iteraciones.config.yaml"
      Y la salida dice "✔ permisos de lectura en cwd"

    # Un `\x1b` que se cuela en la salida rompe el parseo de `doctor --json` en
    # un watcher, y en una terminal ensucia la lista.
    #
    # El escenario va con `NO_COLOR` porque el contrato es sobre la salida que
    # leen las máquinas (el `--json`, el pipe del watcher): en un terminal el
    # color es lo esperado y afirmarlo sería afirmar lo contrario de lo que
    # importa. Con el color apagado, cualquier escape que quede es uno hardcodeado
    # en el render de los checks — que es exactamente la regresión.

    Escenario: La salida de doctor no lleva códigos ANSI
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y el entorno pide no usar color
      Cuando corro "doctor"
      Entonces la salida no lleva códigos ANSI

    Escenario: Una configuración inválida se marca con ✖ y el detalle
      Dado que la raíz del proyecto tiene una configuración inválida
      Cuando corro "doctor"
      Entonces el comando termina con el código de salida 1
      Y la salida dice "✖ iteraciones.config.yaml"
      Y la salida dice "Error de sintaxis"

  Regla de negocio: doctor --json responde en la misma forma

    Escenario: Un proyecto en orden sale como JSON
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Cuando parseo el comando "doctor --json" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 0
      Y el JSON declara la clave "ok" con el valor verdadero
      Y el JSON declara al menos 1 check

    Escenario: Una configuración inválida sale con ok:false
      Dado que la raíz del proyecto tiene una configuración inválida
      Cuando parseo el comando "doctor --json" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 1
      Y el JSON declara la clave "ok" con el valor falso
      Y el JSON declara al menos 1 check con error

  Regla de negocio: doctor --info separa lo tuyo de los defaults del paquete

    # Dos listas que se leen parecido y significan cosas distintas: lo que el
    # usuario desactivó y lo que el paquete ya trae desactivado. Confundirlas
    # hace que el usuario Reactive los defaults pensando que los apagó él.

    @requires-pandoc
    Escenario: --info refleja la salida real del último build
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Cuando compilo el proyecto en la salida "salida"
      Y pido la información de "doctor"
      Entonces el comando termina con el código de salida 0
      Y la salida dice "salida"
      Y la salida dice "(generado)"

    Escenario: --info distingue lo que desactivaste de los defaults
      Dado que la raíz del proyecto tiene un proyecto con 19-maketitle desactivado
      Cuando pido la información de "doctor"
      Entonces la línea de "filters de preámbulo desactivados (config):" dice "19-maketitle"
      Y la línea de "filters de preámbulo desactivados (defaults del paquete):" dice "97-eso-pic, 98-crop, 99-pdfx"

    # Escribir un default en el YAML es una decisión del usuario, aunque el
    # valor coincida. Antes la sustracción lo ocultaba de la línea de config y
    # el usuario veía "ninguno" con un filtro escrito de puño y suyo.

    Escenario: Un default escrito en el YAML cuenta como config
      Dado que la raíz del proyecto tiene un proyecto con 97-eso-pic desactivado
      Cuando pido la información de "doctor"
      Entonces la línea de "filters de preámbulo desactivados (config):" dice "97-eso-pic"
      Y la línea de "filters de preámbulo desactivados (config):" no dice "(ninguno)"

    Escenario: Sin desactivaciones propias la línea de config dice (ninguno)
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Cuando pido la información de "doctor"
      Entonces la línea de "filters de preámbulo desactivados (config):" dice "(ninguno)"
      Y las dos líneas de filtros de preámbulo están alineadas

    # #2192: antes cada línea del bloque llevaba su propio prefijo `[doctor]`.
    # Con veinte líneas de config, veinte prefijos, y el bloque se lee como
    # veinte mensajes distintos en vez de uno.

    Escenario: El bloque de información lleva un único prefijo
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Cuando pido la información de "doctor"
      Entonces la línea del encabezado de la configuración lleva el prefijo "[doctor]"
      Y ninguna línea de la configuración lleva el prefijo "[doctor]"

  Regla de negocio: list-filters alcanza sin configuración

    # #2071: la lista de filtros no necesita proyecto. Es la forma de ver qué
    # hace el CLI cuando todavía no se creó ninguno.

    Escenario: list-filters funciona en un directorio vacío
      Dado que la raíz del proyecto está vacía
      Cuando corro "list-filters"
      Entonces el comando termina con el código de salida 0

  Regla de negocio: list-filters muestra una línea por filtro

    # #2027: el detalle completo de cada filtro no cabe en un terminal. Por
    # defecto va la primera oración; el resto está en el registro.

    Escenario: Por defecto cada filtro sale con su primera oración
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Cuando listo los filtros en 400 columnas
      Entonces la salida lista "latex/02-dictum" como activa con su primera oración
      Y la salida no dice "si es Para."
      Y la salida no dice "expone el CLI como metadata babel-lang"

    Escenario: --verbose devuelve las descripciones completas
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Cuando listo los filtros en 400 columnas con detalle
      Entonces la salida dice "si es Para."
      Y la salida dice "expone el CLI como metadata babel-lang"
      Y la salida dice "sin el texto de información"
      Y la salida lista "latex/02-dictum" como activa con su primera oración

    # En un terminal angosto, truncar es lo correcto: partir la línea a la mitad
    # de una palabra es peor que una elipsis.

    Escenario: En un terminal angosto las descripciones se truncan
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Cuando listo los filtros en 40 columnas
      Entonces el comando termina con el código de salida 0
      Y la salida no dice "si es Para."
      Y la salida lleva una elipsis

  Regla de negocio: list-filters --json declara el estado de cada filtro

    Escenario: El JSON de filtros dice cuáles están activos
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Cuando listo los filtros pidiendo JSON
      Entonces el comando termina con el código de salida 0
      Y el JSON declara al menos 1 filtro
      Y el JSON declara el primer filtro de tipo "lua"
      Y el JSON declara el estado del primer filtro
      Y el JSON declara al menos 1 filtro de preámbulo
      Y el JSON declara el primer filtro de preámbulo de tipo "preamble"