# language: es
Característica: la bibliografía cuando el proyecto no cita nada

  Como quien escribe un libro sin bibliografía
  Quiero que LaTeX no se queje de citas que no existen
  Para no perder el tiempo buscando un problema que no tengo

  # Tramo 48 de la migración. 8 de los 8 casos de `bibliography-preamble.test.ts`.
  # El archivo queda cerrado.

  # Un proyecto sin un solo `.bib` no cita nada. Con `csquotes` y `biblatex`
  # cargados, LaTeX emite avisos por cada `\cite` vacío y el log se llena de ruido
  # que no es un error. Peor: el autor ve advertencias de bibliografía en un libro
  # que no tiene bibliografía.

  Regla de negocio: Sin `.bib` el snippet se apaga

    Escenario: Sin archivos .bib se desactiva el snippet
      Dado que la raíz del proyecto está vacía
      Y ningún archivo .bib
      Y desactivados ""
      Cuando aplico la regla de la bibliografía
      # El resultado es la lista de desactivados con `11-bibliography` encima.
      Entonces el resultado son "11-bibliography"

    Escenario: Con un archivo .bib no se toca nada
      Dado que la raíz del proyecto está vacía
      Y ningún archivo .bib
      Y un archivo .bib en "/proyecto/libro.bib"
      Y desactivados ""
      Cuando aplico la regla de la bibliografía
      # Hay bibliografía, así que el snippet se queda como estaba.
      Entonces el resultado son ""

    # `bibFiles` llega a `undefined` cuando nadie la calculó todavía. Desactivar el
    # snippet con esa información sería adivinar, y adivinar aquí significa
    # apagar la bibliografía de un libro que sí la tiene.
    Escenario: Sin lista previa no se arriesga a desactivar nada
      Dado que la raíz del proyecto está vacía
      Y ningún archivo .bib
      Y desactivados ""
      Y la lista previa de .bib no se calculó
      Cuando aplico la regla de la bibliografía
      # La función prefiere no hacer nada antes que apagar lo que no sabe.
      Entonces el resultado son ""

    # Sin duplicar: si el autor ya lo desactivó a mano, no aparece dos veces.
    Escenario: No se duplica si ya estaba desactivado
      Dado que la raíz del proyecto está vacía
      Y ningún archivo .bib
      Y desactivados "11-bibliography"
      Cuando aplico la regla de la bibliografía
      # Una vez, no dos.
      Entonces el resultado son "11-bibliography"

  Regla de negocio: El build escribe la plantilla sin el paquete

    Escenario: Sin .bib la plantilla no carga la bibliografía
      Dado que la raíz del proyecto está vacía
      Y un proyecto con una bibliografía en "libro.bib"
      Y ningún archivo .bib
      Y desactivados ""
      Cuando compongo la plantilla LaTeX del build
      # Ni `csquotes` ni `biblatex`: los avisos de `\cite` vacío desaparecen.
      Entonces la plantilla NO lleva "\usepackage{csquotes}"
      Y la plantilla NO lleva "\usepackage[style=apa]{biblatex}"
      Y biblatex queda "false"

    Escenario: Con .bib la plantilla vuelve a cargar la bibliografía
      Dado que la raíz del proyecto está vacía
      Y un proyecto con una bibliografía en "libro.bib"
      Y un archivo .bib en "/proyecto/libro.bib"
      Y desactivados ""
      Cuando compongo la plantilla LaTeX del build
      # El paquete vuelve con el estilo configurado.
      Entonces la plantilla SÍ lleva "\usepackage[style=apa]{biblatex}"
      Y biblatex queda "true"

  # --- Tramo 48: los tres sitios que aplican la misma regla ---

  # El build, `iteraciones template` y `iteraciones filters` tienen que decir lo
  # mismo, porque el `.sh` regenera las plantillas con `template`: si `template`
  # dijera una cosa y el build otra, el PDF del `.sh` saldría distinto del que dio
  # el build.

  Regla de negocio: `template` dice lo mismo que el build

    Escenario: La plantilla regenerada respeta la regla
      Dado que la raíz del proyecto está vacía
      Y un proyecto de prueba inicializado
      # El proyecto inicializado no trae `.bib`.
      Y la plantilla NO lleva el paquete de bibliografía
      Y un proyecto con una bibliografía en "libro.bib"
      Cuando vuelvo a generar la plantilla LaTeX
      # El `.bib` apareció: el snippet vuelve.
      Entonces la plantilla SÍ lleva el paquete de bibliografía

  Regla de negocio: `filters` muestra el estado que aplica el build

    Escenario: El filtro 11-bibliography se muestra inactivo sin .bib
      Dado que la raíz del proyecto está vacía
      Y un proyecto de prueba inicializado
      Cuando pregunto el estado de 11-bibliography
      # El mismo estado que aplicaría el build, no una cuenta aparte.
      Entonces 11-bibliography está "false"

    Escenario: El filtro 11-bibliography se muestra activo con .bib
      Dado que la raíz del proyecto está vacía
      Y un proyecto de prueba inicializado
      Y un proyecto con una bibliografía en "libro.bib"
      Cuando pregunto el estado de 11-bibliography
      # Con `.bib` presente, el snippet se queda.
      Entonces 11-bibliography está "true"

  # Con el snippet apagado, `biblatex` no está: `latexmk` no debe buscar el `.bib`,
  # y la flag evita un segundo punto de fallo.

  Regla de negocio: El compilador recibe -nobibtex cuando no puede citar

    Escenario: Con noBibtex latexmk recibe la flag
      Dado que la raíz del proyecto está vacía
      Y un latexmk falso que registra sus argumentos
      Cuando compilo el PDF con noBibtex "true"
      Entonces latexmk recibe -nobibtex
      Cuando restauro el PATH
      # Sin `biblatex` cargado, buscar el `.bib` sería un segundo fallo.

    Escenario: Sin noBibtex latexmk no recibe la flag
      Dado que la raíz del proyecto está vacía
      Y un latexmk falso que registra sus argumentos
      Cuando compilo el PDF con noBibtex "false"
      Entonces latexmk NO recibe -nobibtex
      Cuando restauro el PATH