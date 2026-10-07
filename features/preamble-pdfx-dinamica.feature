# language: es
Característica: las boxes del PDF/X-1a y la dinámica de la cola

  Como quien certifica su PDF en PDF/X-1a
  Quiero que las cuatro boxes salgan bien y que la cola toque lo que toca
  Para que la certificación valga y el crop no se modifique sin motivo

  Regla de negocio: Las cuatro boxes del PDF/X-1a

    Escenario: Sin crop, las boxes son la página
      Dado que la raíz del proyecto está vacía
      Dado que el proyecto tiene los filtros:
      """
      01-documentclass \documentclass{scrbook}
      """
      Cuando detecto el tamaño del papel
      Y que el crop está "inactivo"
      Y compongo las páginas del PDFX
      Entonces las páginas del PDFX traen "/TrimBox [0 0"

    Escenario: Con crop, el TrimBox lleva el offset
      Dado que la raíz del proyecto está vacía
      Dado que el proyecto tiene los filtros:
      """
      01-documentclass \documentclass{scrbook}
      """
      Cuando detecto el tamaño del papel
      Y que el crop está "activo"
      Y compongo las páginas del PDFX
      Entonces las páginas del PDFX traen "/MediaBox [0 0"
      Y las páginas del PDFX traen "/TrimBox ["

  Regla de negocio: La dinámica de la cola toca lo que toca

    Escenario: Sin crop ni pdfx no se modifica nada
      Dado que la raíz del proyecto está vacía
      Dado que el proyecto tiene los filtros:
      """
      01-documentclass \documentclass{scrbook}
      """
      Cuando aplico la dinámica de la cola de imprenta
      Entonces el filtro "01-documentclass" quedó intacto

    Escenario: Sólo el crop activo toca el 98-crop
      Dado que la raíz del proyecto está vacía
      Dado que el proyecto tiene los filtros:
      """
      98-crop old ;; 99-pdfx \usepackage[x-1a1]{pdfx}\n\n\pdfpagesattr{old}
      """
      Cuando aplico la dinámica de la cola de imprenta
      Entonces el filtro "98-crop" trae "width=221.9truemm"
      Y el filtro "99-pdfx" trae "\usepackage[x-1a1]{pdfx}"

    Escenario: Sólo el pdfx activo no toca el crop
      Dado que la raíz del proyecto está vacía
      Dado que el proyecto tiene los filtros:
      """
      99-pdfx \usepackage[x-1a1]{pdfx}\n\n\pdfpagesattr{old}
      """
      Cuando aplico la dinámica de la cola de imprenta
      Entonces el filtro "99-pdfx" trae "/TrimBox [0 0"
      Y el filtro "99-pdfx" no trae "width=221.9truemm"
