# language: es
Característica: lo que el build borra y lo que deja

  Como quien borra un capítulo del libro
  Quiero que sus archivos salgan de la salida
  Para que `dist` no crezca con cosas que ya nadie pidió

  # Tramo 44 de la migración. 4 de los 11 casos de
  # `build-assets-cleanup.test.ts`.

  # Tres motivos para borrar, tres alcances distintos. Confundirlos deja
  # archivos muertos o borra trabajo vivo.

  Regla de negocio: Un documento borrado se limpia entero

    # Sus salidas y también su área de trabajo del PDF: los `.aux` y los `.log`
    # de LaTeX son la mitad del coste de la siguiente compilación.

    Escenario: Se van el área de trabajo del PDF y las salidas
      Dado que la raíz del proyecto está vacía
      Y un documento borrado con slug "perdido" y estos artefactos:
        """
        .iteraciones/tmp/pdf/perdido.tex
        .iteraciones/tmp/pdf/perdido.aux
        .iteraciones/tmp/pdf/perdido.log
        dist/files/perdido.html
        """
      Cuando limpio los documentos borrados
      # Los tres del área de trabajo y la salida.
      Entonces estos archivos ya no están:
        """
        .iteraciones/tmp/pdf/perdido.tex
        .iteraciones/tmp/pdf/perdido.aux
        .iteraciones/tmp/pdf/perdido.log
        dist/files/perdido.html
        """

    # `index.md` genera salidas en todos los formatos con el MISMO nombre. Si la
    # limpieza mirara sólo el slug (`inicio`), no borraría nada.
    Escenario: Se van todas las salidas de un index.md borrado
      Dado que la raíz del proyecto está vacía
      Y un documento borrado sin slug conocido y estos artefactos:
        """
        dist/files/index.html
        dist/files/index.pdf
        dist/files/index.tex
        dist/files/index.epub
        dist/files/index.md
        dist/files/otro.html
        """
      Cuando limpio los documentos borrados
      # Todas las de `index`, y sólo las de `index`.
      Entonces estos archivos ya no están:
        """
        dist/files/index.html
        dist/files/index.pdf
        dist/files/index.tex
        dist/files/index.epub
        dist/files/index.md
        """
      Y estos archivos siguen aquí:
        """
        dist/files/otro.html
        """

    Escenario: Un slug que cambió se limpia entero
      Dado que la raíz del proyecto está vacía
      Y un documento que antes se llamaba "slug-viejo"
      Cuando limpio el slug que cambió
      # Sin esto, `dist` engorda en cada renombre.
      Entonces estos archivos ya no están:
        """
        dist/files/slug-viejo.html
        """

    # Un formato que ya no se pide se va con sus assets. Y los del layout
    # ANTERIOR también (#2450): si no, un proyecto que upgraded deja `css/` y
    # `fonts/` en la raíz para siempre.
    Escenario: Se va un formato con los assets de los dos layouts
      Dado que la raíz del proyecto está vacía
      Y una salida con salidas de "html"
      Y una salida con assets del layout nuevo y del anterior
      Cuando limpio los formatos que ya no se piden
      # El HTML sí se va; el PDF y el LaTeX se quedan porque siguen activos.
      Entonces estos archivos ya no están:
        """
        dist/files/doc.html
        dist/files/assets/css/styles.css
        dist/files/assets/fonts/x.ttf
        dist/files/assets/logo.svg
        dist/files/css/styles.css
        dist/files/fonts/x.ttf
        dist/files/logo.svg
        """
      Y estos archivos siguen aquí:
        """
        dist/files/doc.pdf
        dist/files/doc.tex
        """