# language: es
Característica: el índice del PDF no sale vacío

  Como quien arma un texto para imprimir
  Quiero que no aparezca una página de índice sin entradas
  Para no dejar una página en blanco al principio del documento

  El índice sólo muestra los encabezados de nivel menor o igual al tocdepth.
  Si el documento no tiene ninguno de ese nivel, la página sale vacía: mejor
  que no salga.

  Regla de negocio: El índice sólo aparece si hay algo que indizar

    Escenario: Un tocdepth amplio deja el índice del texto
      Dado un proyecto de LaTeX con tocdepth 5
      Y un texto con el encabezado "## Una sección"
      Cuando compilo el proyecto para leer el índice
      Entonces el LaTeX de "un-texto.tex" tiene el índice

    Escenario: Un tocdepth corto se lleva el índice del texto
      Dado un proyecto de LaTeX con tocdepth 1
      Y un texto con el encabezado "## Una sección"
      Cuando compilo el proyecto para leer el índice
      Entonces el LaTeX de "un-texto.tex" no tiene el índice

    Escenario: La sección de autoras no hace aparecer el índice
      Dado un proyecto de LaTeX con tocdepth 1
      Y un texto con el encabezado "## Una sección" y con creadora
      Cuando compilo el proyecto para leer el índice
      Entonces el LaTeX de "un-texto-por-ana-garcia.tex" no tiene el índice
      Y el LaTeX de "un-texto-por-ana-garcia.tex" contiene "Autoras y colaboradoras"

    Escenario: Una colección conserva su índice
      Dado un proyecto de LaTeX con tocdepth 1
      Y una colección con un miembro
      Cuando compilo el proyecto para leer el índice
      Entonces el LaTeX de "coleccion.tex" tiene el índice

    Escenario: Sin override del proyecto manda el tocdepth del paquete
      Dado un proyecto de LaTeX sin tocdepth
      Y un texto con el encabezado "## Una sección"
      Cuando compilo el proyecto para leer el índice
      Entonces el LaTeX de "un-texto.tex" tiene el índice
