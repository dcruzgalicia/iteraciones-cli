# language: es
Característica: la bibliografía cuando el proyecto no cita nada

  Como quien escribe un libro sin bibliografía
  Quiero que LaTeX no se queje de citas que no existen
  Para no perder el tiempo buscando un problema que no tengo

  Regla de negocio: Sin `.bib` el snippet se apaga

    Escenario: Sin archivos .bib se desactiva el snippet
      Dado que la raíz del proyecto está vacía
      Y ningún archivo .bib
      Y desactivados ""
      Cuando aplico la regla de la bibliografía
      Entonces el resultado son "11-bibliography"

    Escenario: Con un archivo .bib no se toca nada
      Dado que la raíz del proyecto está vacía
      Y ningún archivo .bib
      Y un archivo .bib en "/proyecto/libro.bib"
      Y desactivados ""
      Cuando aplico la regla de la bibliografía
      Entonces el resultado son ""

    Escenario: Sin lista previa no se arriesga a desactivar nada
      Dado que la raíz del proyecto está vacía
      Y ningún archivo .bib
      Y desactivados ""
      Y la lista previa de .bib no se calculó
      Cuando aplico la regla de la bibliografía
      Entonces el resultado son ""

    Escenario: No se duplica si ya estaba desactivado
      Dado que la raíz del proyecto está vacía
      Y ningún archivo .bib
      Y desactivados "11-bibliography"
      Cuando aplico la regla de la bibliografía
      Entonces el resultado son "11-bibliography"

  Regla de negocio: El build escribe la plantilla sin el paquete

    Escenario: Sin .bib la plantilla no carga la bibliografía
      Dado que la raíz del proyecto está vacía
      Y un proyecto con una bibliografía en "libro.bib"
      Y ningún archivo .bib
      Y desactivados ""
      Cuando compongo la plantilla LaTeX del build
      Entonces la plantilla NO lleva "\usepackage{csquotes}"
      Y la plantilla NO lleva "\usepackage[style=apa]{biblatex}"
      Y biblatex queda "false"

    Escenario: Con .bib la plantilla vuelve a cargar la bibliografía
      Dado que la raíz del proyecto está vacía
      Y un proyecto con una bibliografía en "libro.bib"
      Y un archivo .bib en "/proyecto/libro.bib"
      Y desactivados ""
      Cuando compongo la plantilla LaTeX del build
      Entonces la plantilla SÍ lleva "\usepackage[style=apa]{biblatex}"
      Y biblatex queda "true"

  Regla de negocio: `template` dice lo mismo que el build

    Escenario: La plantilla regenerada respeta la regla
      Dado que la raíz del proyecto está vacía
      Y un proyecto de prueba inicializado
      Y la plantilla NO lleva el paquete de bibliografía
      Y un proyecto con una bibliografía en "libro.bib"
      Cuando vuelvo a generar la plantilla LaTeX
      Entonces la plantilla SÍ lleva el paquete de bibliografía

  Regla de negocio: la ayuda de `filters` dice dónde va cada override

    Escenario: La ayuda nombra los cuatro directorios de override de preámbulo
      Dado que la raíz del proyecto está vacía
      Y un proyecto de prueba inicializado
      Cuando pregunto la ayuda de los overrides de preámbulo
      Entonces la ayuda menciona los 4 directorios de override

  Regla de negocio: `filters` muestra el estado que aplica el build

    Escenario: El filtro 11-bibliography se muestra inactivo sin .bib
      Dado que la raíz del proyecto está vacía
      Y un proyecto de prueba inicializado
      Cuando pregunto el estado de 11-bibliography
      Entonces 11-bibliography está "false"

    Escenario: El filtro 11-bibliography se muestra activo con .bib
      Dado que la raíz del proyecto está vacía
      Y un proyecto de prueba inicializado
      Y un proyecto con una bibliografía en "libro.bib"
      Cuando pregunto el estado de 11-bibliography
      Entonces 11-bibliography está "true"

  Regla de negocio: El compilador recibe -nobibtex cuando no puede citar

    Escenario: Con noBibtex latexmk recibe la flag
      Dado que la raíz del proyecto está vacía
      Y un latexmk falso que registra sus argumentos
      Cuando compilo el PDF con noBibtex "true"
      Entonces latexmk recibe -nobibtex
      Cuando restauro el PATH

    Escenario: Sin noBibtex latexmk no recibe la flag
      Dado que la raíz del proyecto está vacía
      Y un latexmk falso que registra sus argumentos
      Cuando compilo el PDF con noBibtex "false"
      Entonces latexmk NO recibe -nobibtex
      Cuando restauro el PATH