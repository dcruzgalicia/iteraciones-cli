# language: es
Característica: el bloque de autoras de una collection llega al LaTeX siempre que hay creators

  Como quien publica una antología sin que el proyecto cite nada
  Quiero que las bios de las colaboradoras aparezcan igual
  Para no perder las firmas por una razón que no tiene que ver con el contenido

  Regla de negocio: La bibliografía del proyecto no decide si hay bloque

    Escenario: Sin bibliografía el bloque se inserta igual
      Dado el proyecto de una collection con una creadora
      Cuando compilo el proyecto para leer su LaTeX
      Entonces el LaTeX de "antologia-por-editora.tex" tiene "Autoras y colaboradoras"
      Y el LaTeX de "antologia-por-editora.tex" tiene "subsubsection{Ana García}"
      Y el LaTeX de "antologia-por-editora.tex" tiene "de Ana."
      Y el bloque va antes de "\end{document}"

    Escenario: Sin bibliografía y sin colophon el bloque no se pierde
      Dado el proyecto de una collection con una creadora
      Cuando compilo el proyecto para leer su LaTeX
      Entonces el LaTeX de "antologia-por-editora.tex" no tiene "printbibliography"
      Y el LaTeX de "antologia-por-editora.tex" no tiene "\colophon{"
      Y el LaTeX de "antologia-por-editora.tex" tiene "Autoras y colaboradoras"

    Escenario: Sin creators coincidentes no hay bloque
      Dado el proyecto de una collection con una creadora
      Y el proyecto no tiene el archivo "ana.md"
      Cuando compilo el proyecto para leer su LaTeX
      Entonces el LaTeX de "antologia-por-editora.tex" no tiene "Autoras y colaboradoras"

  Regla de negocio: Con bibliografía el bloque conserva su lugar

    Escenario: El bloque se inserta antes de la bibliografía
      Dado el proyecto de una collection que cita su bibliografía
      Cuando compilo el proyecto para leer su LaTeX
      Entonces el LaTeX de "antologia-por-editora.tex" tiene "printbibliography"
      Y el bloque va antes de "\printbibliography"

  Regla de negocio: El ancla decide dónde va, no si va

    Escenario: Con bibliografía el bloque queda pegado a ella
      Dado el LaTeX de la colección es "cuerpo \printbibliography \end{document}"
      Y el bloque de autoras es "BLOQUE"
      Cuando inserto el bloque de autoras
      Entonces el bloque de autoras quedó justo antes de "\printbibliography"
      Y ningún aviso del bloque dice "no se insertó"

    Escenario: Con colophon el bloque queda pegado a él
      Dado el LaTeX de la colección es "cuerpo \colophon{algo} \end{document}"
      Y el bloque de autoras es "BLOQUE"
      Cuando inserto el bloque de autoras
      Entonces el bloque de autoras quedó justo antes de "\colophon{algo}"
      Y ningún aviso del bloque dice "no se insertó"

    Escenario: Sin bibliografía ni colophon el bloque va antes del fin
      Dado el LaTeX de la colección es "cuerpo \end{document}"
      Y el bloque de autoras es "BLOQUE"
      Cuando inserto el bloque de autoras
      Entonces el bloque de autoras quedó justo antes de "\end{document}"
      Y ningún aviso del bloque dice "no se insertó"

  Regla de negocio: Sin ancla el build avisa en vez de perder el bloque en silencio

    Escenario: Un LaTeX sin ninguna ancla avisa y no rompe
      Dado el LaTeX de la colección es "cuerpo sin fin"
      Y el bloque de autoras es "BLOQUE"
      Cuando inserto el bloque de autoras
      Entonces el bloque de autoras insertado es "cuerpo sin fin"
      Y el aviso del bloque dice "el bloque de autoras no se insertó"

    Escenario: Un bloque vacío no toca el LaTeX
      Dado el LaTeX de la colección es "cuerpo \end{document}"
      Y el bloque de autoras es ""
      Cuando inserto el bloque de autoras
      Entonces el bloque de autoras insertado es "cuerpo \end{document}"
      Y ningún aviso del bloque dice "no se insertó"
