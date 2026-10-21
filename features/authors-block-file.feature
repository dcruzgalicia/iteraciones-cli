# language: es
Característica: el bloque de autoras de un texto llega al LaTeX

  Como quien escribe un texto firmado
  Quiero que la biografía de quien lo escribió aparezca al final
  Para que el texto vaya con su firma

  Regla de negocio: El texto con creadora lleva su bloque

    Escenario: El texto con dos creadoras lleva la sección de autoras
      Dado el proyecto de un texto con dos creadoras
      Cuando compilo el proyecto para leer el LaTeX del texto
      Entonces el LaTeX de "un-texto-por-ana-garcia.tex" tiene "Autoras y colaboradoras"
      Y el LaTeX de "un-texto-por-ana-garcia.tex" tiene "subsubsection{Ana García}"
      Y el LaTeX de "un-texto-por-ana-garcia.tex" tiene "de Ana."
      Y el bloque va antes de "\end{document}"

    Escenario: Un texto con una sola creadora no lleva el encabezado de la sección
      Dado el proyecto de un texto con una creadora
      Cuando compilo el proyecto para leer el LaTeX del texto
      Entonces el LaTeX de "un-texto-por-ana-garcia.tex" no tiene "Autoras y colaboradoras"
      Y el LaTeX de "un-texto-por-ana-garcia.tex" tiene "subsubsection{Ana García}"
      Y el LaTeX de "un-texto-por-ana-garcia.tex" tiene "de Ana."

    Escenario: El nombre de cada creadora va centrado
      Dado el proyecto de un texto con dos creadoras
      Cuando compilo el proyecto para leer el LaTeX del texto
      Entonces el LaTeX de "un-texto-por-ana-garcia.tex" tiene "setkomafont{subsubsection}{\centering\normalsize\normalfont\scshape}"

    Escenario: Un texto sin creadora no lleva la sección
      Dado el proyecto de un texto con dos creadoras
      Y el proyecto no tiene el archivo "ana.md"
      Y el proyecto no tiene el archivo "berta.md"
      Cuando compilo el proyecto para leer el LaTeX del texto
      Entonces el LaTeX de "un-texto-por-ana-garcia.tex" no tiene "Autoras y colaboradoras"

    Escenario: La sección va al final, después del texto
      Dado el proyecto de un texto con dos creadoras
      Cuando compilo el proyecto para leer el LaTeX del texto
      Entonces el LaTeX de "un-texto-por-ana-garcia.tex" pone "Contenido." antes que "Autoras y colaboradoras"

    Escenario: En un texto la sección de autoras es una sección, no una parte
      Dado el proyecto de un texto con dos creadoras
      Cuando compilo el proyecto para leer el LaTeX del texto
      Entonces el LaTeX de "un-texto-por-ana-garcia.tex" tiene "section{Autoras y colaboradoras}"
      Y el LaTeX de "un-texto-por-ana-garcia.tex" no tiene "part{Autoras y colaboradoras}"

  Regla de negocio: Cambia la creadora, se rehace el texto

    Escenario: Al cambiar la creadora se rehace el texto que la cita
      Dado el proyecto de un texto con dos creadoras
      Y el proyecto cambia la creadora
      Cuando compilo el proyecto para leer el LaTeX del texto
      Entonces el LaTeX de "un-texto-por-ana-garcia.tex" tiene "Bio nueva."
